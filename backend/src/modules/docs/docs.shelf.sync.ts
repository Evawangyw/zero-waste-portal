// 模块边界：docs（书架层 · 索引同步编排）
// 契约（对外经 docs/index.ts 暴露）：syncShelfIndex()
//
// 职责：把「PRD §9.3 文件名清洗」+「custom_metadata 四维度解析」的结果注入 syncIndex()，
// 让一次同步就把书架要检索的列全部落库。
// 分层：weknora 适配层不认识本项目的清洗规则（反向 import 会成环），
// 故由本模块提供 mapper 注入 —— syncIndex() 仍是唯一的同步执行者。
import type { PrismaClient } from '@prisma/client'
import { syncIndex } from '../../weknora/index.js'
import type {
  KnowledgeIndexRow,
  SyncIndexResult,
  WeKnoraClient,
  WeKnoraKnowledge,
} from '../../weknora/index.js'
import { cleanFileName, parseShelfMetadata } from './docs.shelf.clean.js'

export interface SyncShelfIndexOptions {
  readonly knowledgeBaseId?: string
  readonly client?: WeKnoraClient
  readonly prisma?: PrismaClient
}

/** 同步书架索引（全量 upsert + 对账） */
export function syncShelfIndex(options: SyncShelfIndexOptions = {}): Promise<SyncIndexResult> {
  return syncIndex({
    knowledgeBaseId: options.knowledgeBaseId,
    client: options.client,
    prisma: options.prisma,
    mapRow: toShelfRow,
  })
}

/**
 * WeKnora knowledge -> KnowledgeIndex 行（含书架检索列）。
 * 容错全交给 cleanFileName/parseShelfMetadata：脏元数据只会得到空值，不会中断整次同步。
 */
export function toShelfRow(item: WeKnoraKnowledge): KnowledgeIndexRow {
  const cleaned = cleanFileName(item.fileName !== '' ? item.fileName : item.title)
  const meta = parseShelfMetadata(item.customMetadata)
  // 文件没有「知识领域」时，用 WeKnora 标签名做主题，书架才能按标签分类。
  const topics = meta.topics.length > 0 ? meta.topics : item.tags
  return {
    knowledgeId: item.id,
    knowledgeBaseId: item.knowledgeBaseId,
    title: item.title,
    // 上游 file_name 可能为空，回落用 title，保证搜索字段不空
    fileName: cleaned.fileName !== '' ? cleaned.fileName : item.title,
    fileType: item.fileType,
    fileSize: item.fileSize,
    customMetadata: JSON.stringify(item.customMetadata ?? {}),
    tags: JSON.stringify([...item.tags]),
    readableTitle: cleaned.readableTitle,
    year: meta.year,
    org: meta.org,
    docType: meta.docType,
    topics: JSON.stringify([...topics]),
    sourceUpdatedAt: parseDateOrNullSafe(item.updatedAt),
    syncedAt: new Date(),
  }
}

function parseDateOrNullSafe(raw: string): Date | null {
  if (raw === '') return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
