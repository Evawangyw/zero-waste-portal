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
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { loadCorpusIndexStatus, vectorCacheDir } from '../ask/ask.corpus.js'
import { TRACK_EVENTS } from './track.types.js'
import type {
  AdminLibraryStats,
  AdminVisitorRow,
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
  const dayStart = localDayStartMs()
  const dayEnd = dayStart + 86_400_000
  const [
    totalEvents,
    pv,
    uvRows,
    registeredUsers,
    eventRows,
    topSearchTerms,
    shelfSearchPaths,
    zeroResultSearchTerms,
    topAskTerms,
    topDownloads,
    downloadLogRows,
    downloadEvents,
    asksTotal,
    asksNoAnswer,
    asksJudged,
    adminUsers,
    questions,
    pendingSubmissions,
    documents,
    shelfSyncedRows,
    activeTodayRows,
    recentVisitorRows,
    corpusIndex,
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
    prisma.$queryRaw<RawPathRow[]>(Prisma.sql`
      SELECT "path"
      FROM "event_logs"
      WHERE "event" = 'page_view' AND "path" LIKE '/shelf?%q=%'
    `),
    prisma.$queryRaw<RawTermRow[]>(Prisma.sql`
      SELECT "term", COUNT(*) AS "count"
      FROM "event_logs"
      WHERE "event" = 'search' AND "term" <> '' AND "zeroResult" = ${1}
      GROUP BY "term"
      ORDER BY COUNT(*) DESC, "term" ASC
      LIMIT ${STATS_TOP_LIMIT}
    `),
    prisma.$queryRaw<RawTermRow[]>(Prisma.sql`
      SELECT "q" AS "term", COUNT(*) AS "count"
      FROM (
        SELECT CASE
          WHEN "term" <> '' THEN "term"
          ELSE lower(trim(COALESCE(json_extract("payload", '$.question'), '')))
        END AS "q"
        FROM "event_logs"
        WHERE "event" = 'ai_ask'
      )
      WHERE "q" <> ''
      GROUP BY "q"
      ORDER BY COUNT(*) DESC, "q" ASC
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
    prisma.user.count({ where: { isAdmin: true } }),
    prisma.chatMessage.count({ where: { role: 'user' } }),
    prisma.submission.count({ where: { status: 'pending' } }),
    prisma.knowledgeIndex.count(),
    prisma.$queryRaw<RawTimeRow[]>(Prisma.sql`
      SELECT MAX("syncedAt") AS "at" FROM "knowledge_index"
    `),
    prisma.$queryRaw<RawCountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS "total"
      FROM (
        SELECT DISTINCT COALESCE(NULLIF("userId", ''), NULLIF("sessionId", '')) AS "visitor"
        FROM "event_logs"
        WHERE "createdAt" >= ${dayStart} AND "createdAt" < ${dayEnd}
          AND COALESCE(NULLIF("userId", ''), NULLIF("sessionId", '')) IS NOT NULL
      )
    `),
    prisma.$queryRaw<RawVisitorRow[]>(Prisma.sql`
      SELECT
        COALESCE(NULLIF("userId", ''), NULLIF("sessionId", '')) AS "visitor",
        COUNT(*) AS "hits",
        MIN("createdAt") AS "firstSeen",
        MAX("createdAt") AS "lastSeen"
      FROM "event_logs"
      WHERE COALESCE(NULLIF("userId", ''), NULLIF("sessionId", '')) IS NOT NULL
      GROUP BY COALESCE(NULLIF("userId", ''), NULLIF("sessionId", ''))
      ORDER BY MAX("createdAt") DESC
      LIMIT ${STATS_TOP_LIMIT}
    `),
    loadCorpusIndexStatus(),
  ])

  const events = toEventCounts(eventRows)
  const library = await toLibraryStats(prisma, {
    documents,
    registeredUsers,
    adminUsers,
    downloads: downloadLogRows,
    questions,
    visitors: toNumber(uvRows[0]?.['total']),
    activeToday: toNumber(activeTodayRows[0]?.['total']),
    visitHits: pv,
    pendingSubmissions,
    feedbackEvents: events.feedback_submit,
    shelfSyncedAt: toIso(shelfSyncedRows[0]?.['at']),
    recentVisitors: recentVisitorRows,
    corpusIndex,
  })

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    totals: {
      events: totalEvents,
      pv,
      uv: toNumber(uvRows[0]?.['total']),
      registeredUsers,
    },
    events,
    topSearchTerms: mergeSearchTerms(toTermCounts(topSearchTerms), shelfSearchPaths),
    zeroResultSearchTerms: toTermCounts(zeroResultSearchTerms),
    topAskTerms: toTermCounts(topAskTerms),
    topDownloads: toDownloadItems(topDownloads),
    downloads: { logRows: downloadLogRows, events: downloadEvents },
    asks: toAsksSummary(asksTotal, asksNoAnswer, asksJudged),
    library,
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

interface LibraryInput {
  readonly documents: number
  readonly registeredUsers: number
  readonly adminUsers: number
  readonly downloads: number
  readonly questions: number
  readonly visitors: number
  readonly activeToday: number
  readonly visitHits: number
  readonly pendingSubmissions: number
  readonly feedbackEvents: number
  readonly shelfSyncedAt: string | null
  readonly recentVisitors: readonly RawVisitorRow[]
  readonly corpusIndex: Awaited<ReturnType<typeof loadCorpusIndexStatus>>
}

async function toLibraryStats(prisma: PrismaClient, input: LibraryInput): Promise<AdminLibraryStats> {
  const ids = input.recentVisitors
    .map((row) => readString(row.visitor))
    .filter((id) => id !== '')
  const known =
    ids.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
  const names = new Map(known.map((user) => [user.id, user.name]))
  return {
    documents: input.documents,
    regularUsers: Math.max(input.registeredUsers - input.adminUsers, 0),
    adminUsers: input.adminUsers,
    downloads: input.downloads,
    questions: input.questions,
    visitors: input.visitors,
    activeToday: input.activeToday,
    visitHits: input.visitHits,
    pendingSubmissions: input.pendingSubmissions,
    feedbackEvents: input.feedbackEvents,
    index: {
      available: input.corpusIndex.available,
      documentsApproved: input.corpusIndex.documentsApproved,
      documentsTotal: input.corpusIndex.documentsTotal,
      indexedDocuments: input.corpusIndex.indexedDocuments,
      chunks: input.corpusIndex.chunks,
      avgChunksPerDoc: input.corpusIndex.avgChunksPerDoc,
      lastVectorAt: vectorCacheTime(),
      shelfSyncedAt: input.shelfSyncedAt,
      docsWithoutChunks: input.corpusIndex.docsWithoutChunks,
    },
    recentVisitors: input.recentVisitors.map((row) => toVisitorRow(row, names)),
  }
}

function toVisitorRow(row: RawVisitorRow, names: ReadonlyMap<string, string>): AdminVisitorRow {
  const id = readString(row.visitor)
  const name = names.get(id)
  const tail = id.length <= 4 ? id : id.slice(-4)
  return {
    label: name !== undefined && name !== '' ? name : `匿名会话 · ${tail}`,
    hits: toNumber(row.hits),
    firstSeenAt: toIso(row.firstSeen) ?? '',
    lastSeenAt: toIso(row.lastSeen) ?? '',
  }
}

function vectorCacheTime(): string | null {
  try {
    const modified = statSync(resolve(vectorCacheDir(), 'meta.json')).mtime
    return Number.isNaN(modified.getTime()) ? null : modified.toISOString()
  } catch {
    return null
  }
}

function localDayStartMs(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function toIso(value: unknown): string | null {
  const asNumber = toNumber(value)
  if (asNumber > 1_000_000_000_000) {
    const date = new Date(asNumber)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return null
}

interface RawCountRow {
  readonly total?: bigint | number | string | null
}

interface RawTimeRow {
  readonly at?: bigint | number | string | Date | null
}

interface RawVisitorRow {
  readonly visitor?: string | null
  readonly hits?: bigint | number | string | null
  readonly firstSeen?: bigint | number | string | Date | null
  readonly lastSeen?: bigint | number | string | Date | null
}

interface RawTermRow {
  readonly term?: string | null
  readonly count?: bigint | number | string | null
}

interface RawPathRow {
  readonly path?: string | null
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

/**
 * 检索事件优先。早期书架搜索只落在 page_view 的 /shelf?q= 上，没有 search 事件；
 * 同一个词已经有 search 事件时，不再把这些页面浏览加进去，避免一次搜索算两次。
 */
function mergeSearchTerms(
  fromEvents: readonly SearchTermCount[],
  paths: readonly RawPathRow[],
): readonly SearchTermCount[] {
  const counts = new Map<string, number>()
  for (const row of fromEvents) {
    if (row.term === '') continue
    counts.set(row.term, (counts.get(row.term) ?? 0) + row.count)
  }
  const covered = new Set(counts.keys())
  for (const row of paths) {
    const term = termFromShelfPath(readString(row.path))
    if (term === '' || covered.has(term)) continue
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term, 'zh'))
    .slice(0, STATS_TOP_LIMIT)
}

/** 从 /shelf?q=垃圾分类 取出检索词。只认书架自己的地址，登录回跳不算一次检索。 */
function termFromShelfPath(path: string): string {
  const queryIndex = path.indexOf('?')
  if (!path.startsWith('/shelf') || queryIndex < 0) return ''
  const term = new URLSearchParams(path.slice(queryIndex + 1)).get('q') ?? ''
  const collapsed = term.trim().replace(/\s+/gu, ' ').toLowerCase()
  return collapsed.length <= 100 ? collapsed : collapsed.slice(0, 100)
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
