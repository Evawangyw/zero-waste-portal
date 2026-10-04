// 模块边界：docs（书架层 · SQLite 查询）
// 契约（对外经 docs/index.ts 暴露）：queryShelf() / queryFacets()
//
// 铁律落地：本文件**只** import { Prisma } / db 层，**绝不** import weknora 对接层。
// 书架的筛选/排序/分页/搜索 100% 走本地 KnowledgeIndex；打 WeKnora 的只有 syncIndex()。
//
// 为什么用 $queryRaw 而不是 Prisma 高级查询：
//   任务卡要求"年份缺失的排最后"，而 year 空值按 schema 存空串。
//   SQLite 里 '' 在 ASC 时排最前、在 DESC 时**也**排最前 —— 单靠 orderBy: {year:'desc'}
//   会把 41 条无年份的记录顶到最前面，与需求相反。必须用显式
//   ORDER BY CASE WHEN year='' THEN 1 ELSE 0 END ASC, year <dir>
//   才能做到"有年份的按方向排，无年份的两种方向都沉底"。故排序走 raw SQL。
//   WHERE 里的多选/未标注/模糊搜索同走 raw，是为了让"或 + 与 + LIKE 转义"在一处可控可测。
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import {
  MISSING_LABEL,
  type ShelfAppliedFilters,
  type ShelfFacet,
  type ShelfFacetsResponse,
  type ShelfItem,
  type ShelfListResponse,
  type ShelfQuery,
  type ShelfSort,
} from './docs.shelf.types.js'

/** LIKE 模式里需要转义的三个字符（配 ESCAPE '\' 使用） */
const LIKE_ESCAPE_RE = /[\\%_]/g

/** 主题维度存在 JSON 数组串里，用带引号的精确元素匹配：topics LIKE '%"塑料污染"%' */
const TAG_LIKE_TEMPLATE = '%"' + '{value}' + '"%'

/** 书架列表查询 */
export async function queryShelf(
  prisma: PrismaClient,
  query: ShelfQuery,
): Promise<ShelfListResponse> {
  const where = buildWhere(query)
  const offset = (query.page - 1) * query.pageSize

  const [rows, counted] = await Promise.all([
    prisma.$queryRaw<RawShelfRow[]>(Prisma.sql`
      SELECT
        "knowledgeId", "title", "fileName", "readableTitle", "fileType", "fileSize",
        "year", "org", "docType", "topics", "sourceUpdatedAt", "syncedAt"
      FROM "knowledge_index"
      ${where}
      ${orderByClause(query.sort)}
      LIMIT ${query.pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<RawCountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS "total" FROM "knowledge_index" ${where}
    `),
  ])

  const total = toNumber(counted[0]?.['total'])
  const items = rows.map(toShelfItem)

  return {
    success: true,
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0,
    appliedFilters: toAppliedFilters(query),
    zeroResult: items.length === 0,
    sort: query.sort,
  }
}

/** 筛选项枚举 + 计数（前端渲染筛选器用；不实时打 WeKnora） */
export async function queryFacets(
  prisma: PrismaClient,
  knowledgeBaseId: string | undefined,
): Promise<ShelfFacetsResponse> {
  const kbClause =
    knowledgeBaseId === undefined
      ? Prisma.sql``
      : Prisma.sql`WHERE "knowledgeBaseId" = ${knowledgeBaseId}`

  const [typeRows, orgRows, yearRows, topicRows, counted] = await Promise.all([
    prisma.$queryRaw<RawFacetRow[]>(Prisma.sql`
      SELECT "docType" AS "value", COUNT(*) AS "count"
      FROM "knowledge_index" ${kbClause} GROUP BY "docType"
    `),
    prisma.$queryRaw<RawFacetRow[]>(Prisma.sql`
      SELECT "org" AS "value", COUNT(*) AS "count"
      FROM "knowledge_index" ${kbClause} GROUP BY "org"
    `),
    prisma.$queryRaw<RawFacetRow[]>(Prisma.sql`
      SELECT "year" AS "value", COUNT(*) AS "count"
      FROM "knowledge_index" ${kbClause} GROUP BY "year"
    `),
    // 主题是 JSON 数组串，SQLite 无法直接 GROUP BY 展开，取回内存里展开计数
    prisma.$queryRaw<RawTopicRow[]>(Prisma.sql`
      SELECT "topics" AS "topics" FROM "knowledge_index" ${kbClause}
    `),
    prisma.$queryRaw<RawCountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS "total" FROM "knowledge_index" ${kbClause}
    `),
  ])

  return {
    success: true,
    types: toFacets(typeRows),
    orgs: toFacets(orgRows),
    years: toFacets(yearRows, /* yearFirst= */ true),
    tags: toTagFacets(topicRows),
    total: toNumber(counted[0]?.['total']),
  }
}

// ------------------------------------------------------------------ WHERE

/**
 * 拼 WHERE 子句。
 * 维度内多选 = 或，跨维度 = 与；'未标注' 哨兵映射为"该列 = ''"。
 */
function buildWhere(query: ShelfQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = []

  if (query.knowledgeBaseId !== undefined) {
    conditions.push(Prisma.sql`"knowledgeBaseId" = ${query.knowledgeBaseId}`)
  }

  pushScalarFilter(conditions, 'docType', query.types)
  pushScalarFilter(conditions, 'org', query.orgs)
  pushScalarFilter(conditions, 'year', query.years)

  if (query.tags.length > 0) {
    const tagClauses = query.tags.map((tag) =>
      tag === MISSING_LABEL
        ? Prisma.sql`"topics" = ${'[]'}`
        : Prisma.sql`"topics" LIKE ${escapeLike(TAG_LIKE_TEMPLATE.replace('{value}', tag))} ESCAPE '\\'`,
    )
    conditions.push(Prisma.sql`(${Prisma.join(tagClauses, ' OR ')})`)
  }

  if (query.q !== null && query.q !== '') {
    const pattern = `%${escapeLike(query.q)}%`
    conditions.push(
      Prisma.sql`("fileName" LIKE ${pattern} ESCAPE '\\' OR "readableTitle" LIKE ${pattern} ESCAPE '\\' OR "title" LIKE ${pattern} ESCAPE '\\')`,
    )
  }

  if (conditions.length === 0) return Prisma.sql`WHERE 1=1`
  return Prisma.sql`WHERE 1=1 AND ${Prisma.join(conditions, ' AND ')}`
}

/** 标量维度筛选：IN 列表 + （可选）"空值也算命中" */
function pushScalarFilter(
  conditions: Prisma.Sql[],
  column: 'docType' | 'org' | 'year',
  values: readonly string[],
): void {
  if (values.length === 0) return
  const wantsMissing = values.includes(MISSING_LABEL)
  const concrete = values.filter((v) => v !== MISSING_LABEL)

  if (concrete.length === 0) {
    // 只选了"未标注" → 该列必须为空
    conditions.push(Prisma.sql`"${Prisma.raw(column)}" = ''`)
    return
  }
  const inClause = Prisma.sql`"${Prisma.raw(column)}" IN (${Prisma.join(
    concrete.map((v) => Prisma.sql`${v}`),
    ', ',
  )})`
  conditions.push(
    wantsMissing ? Prisma.sql`(${inClause} OR "${Prisma.raw(column)}" = '')` : inClause,
  )
}

/** LIKE 转义：用户搜 "%" 不该变成通配符 */
function escapeLike(value: string): string {
  return value.replace(LIKE_ESCAPE_RE, (ch) => `\\${ch}`)
}

// ------------------------------------------------------------------ ORDER BY

function orderByClause(sort: ShelfSort): Prisma.Sql {
  switch (sort) {
    case 'year_desc':
      return Prisma.sql`ORDER BY (CASE WHEN "year" = '' THEN 1 ELSE 0 END) ASC, "year" DESC, "title" ASC, "knowledgeId" ASC`
    case 'year_asc':
      return Prisma.sql`ORDER BY (CASE WHEN "year" = '' THEN 1 ELSE 0 END) ASC, "year" ASC, "title" ASC, "knowledgeId" ASC`
    case 'title_asc':
      return Prisma.sql`ORDER BY "title" ASC, "knowledgeId" ASC`
    case 'updated_desc':
      return Prisma.sql`ORDER BY ("sourceUpdatedAt" IS NULL) ASC, "sourceUpdatedAt" DESC, "knowledgeId" ASC`
  }
}

// ------------------------------------------------------------------ 行映射

/** Prisma raw 行：字段类型先按 unknown 收，再用守卫收窄（禁 any 逃逸） */
interface RawShelfRow {
  readonly knowledgeId: unknown
  readonly title: unknown
  readonly fileName: unknown
  readonly readableTitle: unknown
  readonly fileType: unknown
  readonly fileSize: unknown
  readonly year: unknown
  readonly org: unknown
  readonly docType: unknown
  readonly topics: unknown
  readonly sourceUpdatedAt: unknown
  readonly syncedAt: unknown
}

interface RawCountRow {
  readonly total: unknown
}

interface RawFacetRow {
  readonly value: unknown
  readonly count: unknown
}

interface RawTopicRow {
  readonly topics: unknown
}

function toShelfItem(row: RawShelfRow): ShelfItem {
  const title = readString(row.title)
  const fileName = readString(row.fileName)
  const readable = readString(row.readableTitle)
  return {
    id: readString(row.knowledgeId),
    title,
    fileName,
    // 清洗不出可读标题时回落到原标题，前端永远有东西可显示
    readableTitle: readable === '' ? title : readable,
    fileType: readString(row.fileType),
    fileSize: toNumber(row.fileSize),
    year: orMissing(readString(row.year)),
    org: orMissing(readString(row.org)),
    docType: orMissing(readString(row.docType)),
    topics: parseTopicsCell(row.topics),
    updatedAt: readDate(row.sourceUpdatedAt),
    syncedAt: readDate(row.syncedAt) ?? '',
  }
}

function toAppliedFilters(query: ShelfQuery): ShelfAppliedFilters {
  return {
    type: [...query.types],
    org: [...query.orgs],
    year: [...query.years],
    tag: [...query.tags],
    q: query.q,
  }
}

/** 空串 -> '未标注'（年份顺带做数字归一，展示更整齐） */
function orMissing(value: string): string {
  return value === '' ? MISSING_LABEL : value
}

function toFacets(rows: readonly RawFacetRow[], yearFirst = false): readonly ShelfFacet[] {
  const list = rows.map((row) => ({
    value: orMissing(readString(row.value)),
    count: toNumber(row.count),
  }))
  list.sort((a, b) => {
    if (yearFirst) {
      // 年份维度：数字年份大的排前面，"未标注"永远沉底
      const aMissing = a.value === MISSING_LABEL
      const bMissing = b.value === MISSING_LABEL
      if (aMissing !== bMissing) return aMissing ? 1 : -1
      if (!aMissing) {
        const diff = Number(b.value) - Number(a.value)
        if (Number.isFinite(diff) && diff !== 0) return diff
      }
    }
    if (a.count !== b.count) return b.count - a.count
    return a.value.localeCompare(b.value, 'zh-Hans-CN')
  })
  return list
}

/** 主题 facet：JSON 数组串在内存里展开计数 */
function toTagFacets(rows: readonly RawTopicRow[]): readonly ShelfFacet[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const topic of parseTopicsCell(row.topics)) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1)
    }
  }
  const list = [...counts].map(([value, count]) => ({ value, count }))
  list.sort((a, b) =>
    a.count !== b.count ? b.count - a.count : a.value.localeCompare(b.value, 'zh-Hans-CN'),
  )
  return list
}

/** topics 单元格：容错解析 JSON 数组串，坏数据当空数组，不抛 */
function parseTopicsCell(value: unknown): readonly string[] {
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

/** 日期单元格：Date 或 ISO 串都收；缺失给 null */
function readDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}
