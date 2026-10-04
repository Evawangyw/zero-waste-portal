// 模块边界：track（统计聚合）
//
// 契约（对外经 index.ts 暴露）：buildStatsSummary(prisma) -> StatsSummaryResponse
//
// 口径唯一出处：docs/task-cards/T07-契约.md §4。实现要点：
//  - 只读自建 SQLite（event_logs + download_logs + users），**不打 WeKnora**（铁律同 docs 书架层）
//  - Top/UV/分组统计走 $queryRaw + 具名参数（可索引、一次往返）；
//    简单计数走 Prisma count（同样一条 SQL，省事且类型安全）
//  - 下载 Top10 读 **download_logs**（T04 权威口径），EventLog 的 download 事件只作对照
//    （两者不等本身就是"有接口被绕过前端直连"的信息，见契约 §6）
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { TRACK_EVENTS } from './track.types.js'
import type {
  AsksSummary,
  DownloadTopItem,
  SearchTermCount,
  StatsSummaryResponse,
  TrackEvent,
} from './track.types.js'

/** Top 榜长度（任务卡：Top10） */
export const STATS_TOP_LIMIT = 10

/** 全量统计摘要（看板一次性拉完；数据量级 P0 是千行级，无需分页/缓存） */
export async function buildStatsSummary(prisma: PrismaClient): Promise<StatsSummaryResponse> {
  const [
    totalEvents,
    pv,
    uvRows,
    registeredUsers,
    eventRows,
    topSearchTerms,
    zeroResultSearchTerms,
    topDownloads,
    downloadLogRows,
    downloadEvents,
    asksTotal,
    asksNoAnswer,
    asksJudged,
  ] = await Promise.all([
    prisma.eventLog.count(),
    prisma.eventLog.count({ where: { event: 'page_view' } }),
    prisma.$queryRaw<RawCountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS "total"
      FROM (
        SELECT DISTINCT COALESCE(NULLIF("userId", ''), NULLIF("sessionId", '')) AS "visitor"
        FROM "event_logs"
        WHERE COALESCE(NULLIF("userId", ''), NULLIF("sessionId", '')) IS NOT NULL
      )
    `),
    prisma.user.count(),
    prisma.eventLog.groupBy({ by: ['event'], _count: { _all: true } }),
    prisma.$queryRaw<RawTermRow[]>(Prisma.sql`
      SELECT "term", COUNT(*) AS "count"
      FROM "event_logs"
      WHERE "event" = 'search' AND "term" <> ''
      GROUP BY "term"
      ORDER BY COUNT(*) DESC, "term" ASC
      LIMIT ${STATS_TOP_LIMIT}
    `),
    prisma.$queryRaw<RawTermRow[]>(Prisma.sql`
      SELECT "term", COUNT(*) AS "count"
      FROM "event_logs"
      WHERE "event" = 'search' AND "term" <> '' AND "zeroResult" = ${1}
      GROUP BY "term"
      ORDER BY COUNT(*) DESC, "term" ASC
      LIMIT ${STATS_TOP_LIMIT}
    `),
    prisma.$queryRaw<RawDownloadRow[]>(Prisma.sql`
      SELECT "docId", MAX("fileName") AS "fileName", COUNT(*) AS "count"
      FROM "download_logs"
      GROUP BY "docId"
      ORDER BY COUNT(*) DESC, "docId" ASC
      LIMIT ${STATS_TOP_LIMIT}
    `),
    prisma.downloadLog.count(),
    prisma.eventLog.count({ where: { event: 'download' } }),
    prisma.eventLog.count({ where: { event: 'ai_ask' } }),
    prisma.eventLog.count({ where: { event: 'ai_ask', noAnswer: true } }),
    prisma.eventLog.count({ where: { event: 'ai_ask', noAnswer: { not: null } } }),
  ])

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    totals: {
      events: totalEvents,
      pv,
      uv: toNumber(uvRows[0]?.['total']),
      registeredUsers,
    },
    events: toEventCounts(eventRows),
    topSearchTerms: toTermCounts(topSearchTerms),
    zeroResultSearchTerms: toTermCounts(zeroResultSearchTerms),
    topDownloads: toDownloadItems(topDownloads),
    downloads: { logRows: downloadLogRows, events: downloadEvents },
    asks: toAsksSummary(asksTotal, asksNoAnswer, asksJudged),
  }
}

/** 无答案率 = noAnswer / judged（judged=0 给 0；口径见契约 §4） */
export function toAsksSummary(total: number, noAnswer: number, judged: number): AsksSummary {
  return {
    total,
    judged,
    noAnswer,
    unjudged: Math.max(total - judged, 0),
    noAnswerRate: judged > 0 ? round4(noAnswer / judged) : 0,
  }
}

// ------------------------------------------------------------------ 行 -> 视图

interface RawCountRow {
  readonly total?: bigint | number | string | null
}

interface RawTermRow {
  readonly term?: string | null
  readonly count?: bigint | number | string | null
}

interface RawDownloadRow {
  readonly docId?: string | null
  readonly fileName?: string | null
  readonly count?: bigint | number | string | null
}

/** 七类事件计数补齐：没发生的给 0，前端不必判空 */
export function toEventCounts(
  rows: readonly { readonly event: string; readonly _count: { readonly _all: number } }[],
): Readonly<Record<TrackEvent, number>> {
  const counts: Record<TrackEvent, number> = {
    page_view: 0,
    search: 0,
    preview: 0,
    download: 0,
    ai_ask: 0,
    register: 0,
    feedback_submit: 0,
  }
  for (const row of rows) {
    const hit = TRACK_EVENTS.find((event) => event === row.event)
    if (hit === undefined) continue
    counts[hit] = toNumber(row._count._all)
  }
  return counts
}

function toTermCounts(rows: readonly RawTermRow[]): readonly SearchTermCount[] {
  return rows.map((row) => ({ term: readString(row.term), count: toNumber(row.count) }))
}

function toDownloadItems(rows: readonly RawDownloadRow[]): readonly DownloadTopItem[] {
  return rows.map((row) => ({
    docId: readString(row.docId),
    fileName: readString(row.fileName),
    count: toNumber(row.count),
  }))
}

/** 比率保留 4 位小数（看板展示够用，且 JSON 里不出现一长串浮点尾巴） */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** SQLite 的 COUNT(*) 经 Prisma raw 可能回 bigint/number/string，统一收成 number */
function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
