// 契约（模块内，对外经 index.ts 暴露）：syncIndex() —— 全量拉取 WeKnora 列表 upsert 进本地 KnowledgeIndex
// 任务卡要求：本卡先建表 + 写一个 syncIndex()（全量 upsert），不要求定时任务。
// 为什么必须本地索引（主控已实测）：WeKnora keyword 搜不到 custom_metadata 值，列表接口也没有
// 按元数据筛选/排序的参数 —— 书架筛选排序只能落本地表。
import type { PrismaClient } from '@prisma/client'
import { getPrisma } from '../db/prisma.js'
import { WeKnoraClient } from './client.js'
import type { WeKnoraKnowledge } from './types.js'

export interface SyncIndexOptions {
  /** 目标知识库 ID，缺省用 .env 的 WEKNORA_KB_ID */
  readonly knowledgeBaseId?: string
  /** 对接层实例（测试可注入假 client） */
  readonly client?: WeKnoraClient
  /** Prisma 实例（测试可注入） */
  readonly prisma?: PrismaClient
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

  const [items, remoteTotal] = await Promise.all([
    client.listAllKnowledge({ knowledgeBaseId: kbId }),
    client.countKnowledge(kbId),
  ])

  // SQLite 无原生 upsert 批量语法，Prisma 的 upsert 逐条执行。
  // 本卡数据量（测试库几十条）逐条完全够用；若 T03 上万条，这里换成 $transaction 批量。
  for (const item of items) {
    const row = toRow(item)
    await prisma.knowledgeIndex.upsert({
      where: { knowledgeId: row.knowledgeId },
      create: row,
      update: {
        knowledgeBaseId: row.knowledgeBaseId,
        title: row.title,
        customMetadata: row.customMetadata,
        tags: row.tags,
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

/** WeKnora knowledge -> KnowledgeIndex 行 */
function toRow(item: WeKnoraKnowledge): {
  knowledgeId: string
  knowledgeBaseId: string
  title: string
  customMetadata: string
  tags: string
  sourceUpdatedAt: Date | null
  syncedAt: Date
} {
  return {
    knowledgeId: item.id,
    knowledgeBaseId: item.knowledgeBaseId,
    title: item.title,
    customMetadata: JSON.stringify(item.customMetadata ?? {}),
    tags: JSON.stringify([...item.tags]),
    sourceUpdatedAt: parseDateOrNull(item.updatedAt),
    syncedAt: new Date(),
  }
}

/** WeKnora 时间为 ISO8601 带时区串（实测形如 2026-10-05T00:44:25.724967+08:00），解析失败存 null */
function parseDateOrNull(raw: string): Date | null {
  if (raw === '') return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
