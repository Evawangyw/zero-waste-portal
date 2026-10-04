// 契约（模块内，对外经 index.ts 暴露）：syncIndex() —— 全量拉取 WeKnora 列表 upsert 进本地 KnowledgeIndex
// 任务卡要求：本卡先建表 + 写一个 syncIndex()（全量 upsert），不要求定时任务。
// 为什么必须本地索引（主控已实测）：WeKnora keyword 搜不到 custom_metadata 值，列表接口也没有
// 按元数据筛选/排序的参数 —— 书架筛选排序只能落本地表。
//
// T03 追加：同步时把「清洗后的可读标题 + 四维度」一并落库，供书架检索。
// 分层取舍：清洗/解析规则是**本项目**的产品规则（PRD §9.3 公文清洗），属 docs 模块；
// 而本模块是 WeKnora 适配层，不允许反向 import docs（会形成 docs->weknora->docs 环）。
// 故这里只留一个 mapRow 钩子：docs 模块把自己的映射规则注进来（T03 由 syncShelfIndex() 注入）。
// 不传 mapRow 时行为与 T01 完全一致（只存原始字段，新列留空），旧调用方零影响。
import type { PrismaClient } from '@prisma/client'
import { getPrisma } from '../db/prisma.js'
import { WeKnoraClient } from './client.js'
import type { WeKnoraKnowledge } from './types.js'

/** KnowledgeIndex 的可写行（全列显式声明，禁 any 逃逸） */
export interface KnowledgeIndexRow {
  readonly knowledgeId: string
  readonly knowledgeBaseId: string
  readonly title: string
  readonly fileName: string
  readonly fileType: string
  readonly fileSize: number
  readonly customMetadata: string
  readonly tags: string
  readonly readableTitle: string
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: string
  readonly sourceUpdatedAt: Date | null
  readonly syncedAt: Date
}

/** 行映射钩子：WeKnora knowledge -> KnowledgeIndex 行 */
export type KnowledgeIndexRowMapper = (item: WeKnoraKnowledge) => KnowledgeIndexRow

export interface SyncIndexOptions {
  /** 目标知识库 ID，缺省用 .env 的 WEKNORA_KB_ID */
  readonly knowledgeBaseId?: string | undefined
  /** 对接层实例（测试可注入假 client） */
  readonly client?: WeKnoraClient | undefined
  /** Prisma 实例（测试可注入） */
  readonly prisma?: PrismaClient | undefined
  /** 自定义行映射（docs 模块用它注入清洗+元数据解析规则）；缺省用原始映射 */
  readonly mapRow?: KnowledgeIndexRowMapper | undefined
}

export interface SyncIndexResult {
  readonly knowledgeBaseId: string
  /** WeKnora 侧 total（权威值） */
  readonly remoteTotal: number
  /** 实际 upsert 条数 */
  readonly upserted: number
  /** 库中该 knowledgeBaseId 的最终行数（用于对账） */
  readonly localRows: number
  /** 是否对账一致（localRows === remoteTotal） */
  readonly inSync: boolean
  readonly finishedAt: string
}

/** 全量同步：拉列表 -> 逐条 upsert -> 对账返回 */
export async function syncIndex(options: SyncIndexOptions = {}): Promise<SyncIndexResult> {
  const prisma = options.prisma ?? getPrisma()
  const client = options.client ?? WeKnoraClient.fromEnv()
  const kbId = options.knowledgeBaseId ?? client.defaultKnowledgeBaseId
  const mapRow = options.mapRow ?? toRawRow

  const [items, remoteTotal] = await Promise.all([
    client.listAllKnowledge({ knowledgeBaseId: kbId }),
    client.countKnowledge(kbId),
  ])

  // SQLite 无原生 upsert 批量语法，Prisma 的 upsert 逐条执行。
  // 本卡数据量（测试库几十条）逐条完全够用；若 T03 上万条，这里换成 $transaction 批量。
  for (const item of items) {
    const row = mapRow(item)
    await prisma.knowledgeIndex.upsert({
      where: { knowledgeId: row.knowledgeId },
      create: row,
      update: {
        knowledgeBaseId: row.knowledgeBaseId,
        title: row.title,
        fileName: row.fileName,
        fileType: row.fileType,
        fileSize: row.fileSize,
        customMetadata: row.customMetadata,
        tags: row.tags,
        readableTitle: row.readableTitle,
        year: row.year,
        org: row.org,
        docType: row.docType,
        topics: row.topics,
        sourceUpdatedAt: row.sourceUpdatedAt,
        syncedAt: row.syncedAt,
      },
    })
  }

  const localRows = await prisma.knowledgeIndex.count({ where: { knowledgeBaseId: kbId } })
  return {
    knowledgeBaseId: kbId,
    remoteTotal,
    upserted: items.length,
    localRows,
    inSync: localRows === remoteTotal,
    finishedAt: new Date().toISOString(),
  }
}

/**
 * 默认映射：原样落 WeKnora 侧字段，新增检索列留空。
 * 这就是 T01 的原始行为，保留它是为了 mapRow 可选时零回归。
 */
function toRawRow(item: WeKnoraKnowledge): KnowledgeIndexRow {
  return {
    knowledgeId: item.id,
    knowledgeBaseId: item.knowledgeBaseId,
    title: item.title,
    fileName: item.fileName,
    fileType: item.fileType,
    fileSize: item.fileSize,
    customMetadata: JSON.stringify(item.customMetadata ?? {}),
    tags: JSON.stringify([...item.tags]),
    readableTitle: '',
    year: '',
    org: '',
    docType: '',
    topics: '[]',
    sourceUpdatedAt: parseDateOrNull(item.updatedAt),
    syncedAt: new Date(),
  }
}

/** WeKnora 时间为 ISO8601 带时区串（实测形如 2026-10-05T00:44:25.724967+08:00），解析失败存 null */
export function parseDateOrNull(raw: string): Date | null {
  if (raw === '') return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
