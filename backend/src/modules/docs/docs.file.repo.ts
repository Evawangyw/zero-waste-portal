// 模块边界：docs（文件层 · 本地索引单条查询）
// 契约（对外经 docs/index.ts 暴露）：findIndexedDoc()
//
// 沿用书架层的「索引优先」原则：详情/预览/下载都先查本地 SQLite knowledge_index，
// 命中就能拿到 file_type / file_size / custom_metadata（判断 unsupported 与 tooLarge 全靠它，
// 不用为了拿一个体积去打引擎）；未命中或字段缺失才回源 WeKnora。
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

/** 索引行（字段先按 unknown 收，再用守卫收窄，禁 any 逃逸） */
export interface IndexedDocRow {
  readonly id: string
  readonly title: string
  readonly fileName: string
  readonly readableTitle: string
  readonly fileType: string
  readonly fileSize: number
  /** custom_metadata 的 JSON 串（脏数据解析失败按 {} 处理） */
  readonly customMetadata: Readonly<Record<string, unknown>>
  readonly tags: readonly string[]
  readonly sourceUpdatedAt: string | null
  readonly syncedAt: string | null
}

interface RawDocRow {
  readonly knowledgeId: unknown
  readonly title: unknown
  readonly fileName: unknown
  readonly readableTitle: unknown
  readonly fileType: unknown
  readonly fileSize: unknown
  readonly customMetadata: unknown
  readonly tags: unknown
  readonly sourceUpdatedAt: unknown
  readonly syncedAt: unknown
}

/** 按 knowledgeId 查索引行；未命中给 null（调用方决定是否回源 WeKnora） */
export async function findIndexedDoc(
  prisma: PrismaClient,
  knowledgeId: string,
): Promise<IndexedDocRow | null> {
  const rows = await prisma.$queryRaw<RawDocRow[]>(Prisma.sql`
    SELECT
      "knowledgeId", "title", "fileName", "readableTitle", "fileType", "fileSize",
      "customMetadata", "tags", "sourceUpdatedAt", "syncedAt"
    FROM "knowledge_index"
    WHERE "knowledgeId" = ${knowledgeId}
    LIMIT 1
  `)
  const row = rows[0]
  if (row === undefined) return null
  return toIndexedDoc(row)
}

function toIndexedDoc(row: RawDocRow): IndexedDocRow {
  return {
    id: readString(row.knowledgeId),
    title: readString(row.title),
    fileName: readString(row.fileName),
    readableTitle: readString(row.readableTitle),
    fileType: readString(row.fileType),
    fileSize: toNumber(row.fileSize),
    customMetadata: parseJsonObject(row.customMetadata),
    tags: parseStringArray(row.tags),
    sourceUpdatedAt: readDate(row.sourceUpdatedAt),
    syncedAt: readDate(row.syncedAt),
  }
}

/** JSON 串 -> 记录；非串/坏 JSON/非对象一律给 {}（不抛） */
function parseJsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'string' || value.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  }
  if (typeof value !== 'string' || value.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  } catch {
    return []
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function readDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}
