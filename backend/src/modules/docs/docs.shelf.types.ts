// 模块边界：docs（书架层，T03）
// 契约：本文件是书架对外数据形状的唯一真相来源，实现（clean/repo/router）都不得偏离。
//
// GET /api/docs?type=&org=&year=&tag=&q=&page=&pageSize=&sort=
//   -> 200 ShelfListResponse
//   sort: 'year_desc'（默认） | 'year_asc' | 'title_asc' | 'updated_desc'
//   多选：type/org/year/tag 内逗号分隔 = 或；跨维度 = 且
//   缺失值哨兵 MISSING_LABEL（'未标注'）：筛它 = 该维度为空
//
// GET /api/docs/facets
//   -> 200 ShelfFacetsResponse
//
// 硬约束（任务卡）：全部查自建 SQLite KnowledgeIndex，**任何分支都不打 WeKnora**。

/** 缺失值分组哨兵：筛选/facets 里用它表示"该维度为空"，不打死过滤 */
export const MISSING_LABEL = '未标注'

/** 每页条数（任务卡：20/页） */
export const SHELF_PAGE_SIZE = 20

/** pageSize 上限，防止前端传 pageSize=99999 拖库 */
export const SHELF_MAX_PAGE_SIZE = 100

/** 排序方式 */
export type ShelfSort = 'year_desc' | 'year_asc' | 'title_asc' | 'updated_desc'

export const SHELF_SORTS: readonly ShelfSort[] = [
  'year_desc',
  'year_asc',
  'title_asc',
  'updated_desc',
]

/** 书架列表项（对外视图，全部 camelCase；不外泄 SQLite 行结构） */
export interface ShelfItem {
  readonly id: string
  readonly title: string
  readonly fileName: string
  /** 清洗后的可读标题（去公文壳/文号/扩展名）。清洗不出东西时回落为 title */
  readonly readableTitle: string
  readonly fileType: string
  readonly fileSize: number
  /** 已归一化：空值一律为 MISSING_LABEL，前端不用再判空 */
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
  /** WeKnora 侧最后更新时间；上游缺失为 null */
  readonly updatedAt: string | null
  /** 本地索引更新时间（前端可显示"索引于…"） */
  readonly syncedAt: string
}

/** GET /api/docs 响应体 */
export interface ShelfListResponse {
  readonly success: true
  readonly items: readonly ShelfItem[]
  /** 命中总数（筛选后、分页前） */
  readonly total: number
  readonly page: number
  readonly pageSize: number
  /** 总页数；total=0 时为 0 */
  readonly totalPages: number
  /** 归一化后的生效筛选条件（回显，前端好确认"我在筛什么"） */
  readonly appliedFilters: ShelfAppliedFilters
  /** 空结果标记：items 为空时 true，前端据此挂"试试问 AI"引导 */
  readonly zeroResult: boolean
  readonly sort: ShelfSort
}

/** 回显用：把未传/空串参数折叠掉后的真实生效条件 */
export interface ShelfAppliedFilters {
  readonly type: readonly string[]
  readonly org: readonly string[]
  readonly year: readonly string[]
  readonly tag: readonly string[]
  readonly q: string | null
}

/** 单个 facet（枚举值 + 该值下的条数） */
export interface ShelfFacet {
  readonly value: string
  readonly count: number
}

/** GET /api/docs/facets 响应体 */
export interface ShelfFacetsResponse {
  readonly success: true
  readonly types: readonly ShelfFacet[]
  readonly orgs: readonly ShelfFacet[]
  readonly years: readonly ShelfFacet[]
  readonly tags: readonly ShelfFacet[]
  /** 索引内总条数（前端算"未标注"占比/空态用） */
  readonly total: number
}

/** 出错时的响应体 */
export interface ShelfErrorResponse {
  readonly success: false
  readonly error: {
    readonly kind: ShelfErrorKind
    readonly message: string
  }
}

export type ShelfErrorKind = 'bad_request' | 'internal'

/** 书架查询入参（未识别/非法参数一律忽略并回落默认，不给前端 400 打断） */
export interface ShelfQuery {
  readonly knowledgeBaseId?: string | undefined
  readonly types: readonly string[]
  readonly orgs: readonly string[]
  readonly years: readonly string[]
  readonly tags: readonly string[]
  /** 文件名/可读标题模糊搜索词；null = 不搜 */
  readonly q: string | null
  readonly page: number
  readonly pageSize: number
  readonly sort: ShelfSort
}

// ------------------------------------------------------------------ 清洗层契约

/**
 * 清洗结果。三个字段各有用途：
 *  - readableTitle：去公文壳/文号/扩展名后的可读标题，参与搜索与展示
 *  - fileName：原始文件名（可能为空串），永远原样保留
 *  - ext：识别到的扩展名（含点，如 '.pdf'），供调用方决定是否再拼回去
 */
export interface CleanResult {
  readonly readableTitle: string
  readonly fileName: string
  readonly ext: string
}

/** 从 custom_metadata 解析出的四维度（空值一律空串，不给 null） */
export interface ParsedMetadata {
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
}
