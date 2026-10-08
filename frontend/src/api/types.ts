// 前端契约层：与 backend/src/modules/{auth,docs,embed} 的响应体一一对应。
// 只放类型与常量，零运行时逻辑；改这里必须先改后端对应模块的 *types.ts。
//
// 铁律提醒：这里**永远不放密钥**。publish token（em_）只存在于后端 .env。

// ---------------------------------------------------------------- auth（T02）

/** 对外错误码（与 auth.types.ts 的 AuthErrorCode 同枚举） */
export type AuthErrorCode =
  | 'VALIDATION_FAILED'
  | 'PHONE_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'AUTH_REQUIRED'
  | 'INVALID_TOKEN'
  | 'USER_GONE'
  | 'INTERNAL_ERROR'

export interface FieldIssue {
  readonly field: string
  readonly message: string
}

export interface AuthErrorBody {
  readonly success: false
  readonly error: {
    readonly code: AuthErrorCode
    readonly message: string
    readonly fields: readonly FieldIssue[]
  }
}

/** 用户对外视图：永不含 passwordHash */
export interface PublicUser {
  readonly id: string
  readonly name: string
  readonly org: string
  readonly occupation: string
  readonly topics: readonly string[]
  readonly phone: string
  readonly isAdmin: boolean
  readonly createdAt: string
}

/** 首页对话里的一条消息 */
export interface ChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly createdAt: string
}

export interface ChatHistoryResponse {
  readonly success: true
  readonly messages: readonly ChatMessage[]
}

export interface SaveChatTurnResponse {
  readonly success: true
  readonly messages: readonly ChatMessage[]
}

export interface RegisterBody {
  readonly name: string
  readonly org: string
  readonly occupation: string
  readonly topics: readonly string[]
  readonly phone: string
  readonly password: string
  readonly consent: true
}

export interface RegisterResponse {
  readonly success: true
  readonly user: PublicUser
}

export interface LoginBody {
  readonly phone: string
  readonly password: string
}

export interface LoginResponse {
  readonly success: true
  readonly token: string
  readonly tokenType: 'Bearer'
  readonly expiresIn: number
  readonly expiresAt: string
  readonly user: PublicUser
}

export interface MeResponse {
  readonly success: true
  readonly user: PublicUser
}

// ---------------------------------------------------------------- 书架（T03）

/** 缺失值哨兵（后端 MISSING_LABEL，前端统一按它过滤） */
export const MISSING_LABEL = '未标注'

/** 排序 key（后端 ShelfSort；中文 label 归前端 constants.ts） */
export type ShelfSort = 'year_desc' | 'year_asc' | 'title_asc' | 'updated_desc'

export interface ShelfItem {
  readonly id: string
  readonly title: string
  readonly fileName: string
  readonly readableTitle: string
  readonly fileType: string
  readonly fileSize: number
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
  readonly updatedAt: string | null
  readonly syncedAt: string
}

export interface ShelfAppliedFilters {
  readonly type: readonly string[]
  readonly org: readonly string[]
  readonly year: readonly string[]
  readonly tag: readonly string[]
  readonly q: string | null
}

export interface ShelfListResponse {
  readonly success: true
  readonly items: readonly ShelfItem[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly totalPages: number
  readonly appliedFilters: ShelfAppliedFilters
  readonly zeroResult: boolean
  readonly sort: ShelfSort
}

export interface ShelfFacet {
  readonly value: string
  readonly count: number
}

export interface ShelfFacetsResponse {
  readonly success: true
  readonly types: readonly ShelfFacet[]
  readonly orgs: readonly ShelfFacet[]
  readonly years: readonly ShelfFacet[]
  readonly tags: readonly ShelfFacet[]
  readonly total: number
}

// ---------------------------------------------------------------- 详情/文件（T04）

export interface DocParsedMetadataView {
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
}

export interface DocDetail {
  readonly id: string
  readonly title: string
  readonly readableTitle: string
  readonly fileName: string
  readonly fileType: string
  readonly fileSize: number
  readonly summary: string | null
  readonly gist: string | null
  readonly folderPath: string
  readonly parseStatus: string
  readonly enableStatus: string
  readonly tags: readonly string[]
  readonly customMetadata: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
}

export interface PreviewAvailability {
  readonly streamable: boolean
  readonly tooLarge: boolean
  readonly unsupported: boolean
  readonly contentType: string
  readonly sizeBytes: number
  readonly maxBytes: number
  readonly reason: string | null
}

export interface DownloadAvailability {
  readonly allowed: true
  readonly fileName: string
}

export interface DocDetailResponse {
  readonly success: true
  readonly doc: DocDetail
  readonly metadata: DocParsedMetadataView
  readonly metadataComplete: boolean
  readonly preview: PreviewAvailability
  readonly download: DownloadAvailability
  readonly source: 'index' | 'weknora' | 'index+weknora'
  readonly upstreamAvailable: boolean
}

/** 预览不可用时后端回的信封（形状固定，前端一个分支处理） */
export interface PreviewEnvelope {
  readonly success: true
  readonly preview: PreviewAvailability
  readonly id: string
  readonly title: string
  readonly fileType: string
  readonly fileSize: number
  readonly downloadUrl: string
}

export interface DocFileErrorBody {
  readonly success: false
  readonly error: {
    readonly kind:
      'bad_request' | 'unauthorized' | 'not_found' | 'upstream_unavailable' | 'internal'
    readonly message: string
  }
}

// ---------------------------------------------------------------- 挂件凭证（T06）

export interface EmbedWidgetPublicConfig {
  readonly baseUrl: string
  readonly channelId: string
  readonly tokenEndpoint: string
  readonly position: string
  readonly title: string
  readonly requireLoginForAsk: boolean
  readonly allowedOrigins: readonly string[]
}

export interface EmbedPublicConfigResponse {
  readonly success: true
  readonly widget: EmbedWidgetPublicConfig
}

/**
 * 换 token 的成功响应。
 * 顶层 token/expiresIn 与信封 data.session_token/expires_in 是同一个值
 * （官方挂件 loader 读 data.*，任务卡契约读顶层），不存在第二份凭证。
 */
export interface EmbedTokenResponse {
  readonly success: true
  readonly token: string
  readonly expiresIn: number
  readonly expiresAt: string
  readonly data: {
    readonly session_token: string
    readonly expires_in: number
  }
}

export type EmbedErrorKind = 'origin_not_allowed' | 'login_required' | 'upstream_error' | 'internal'

export interface EmbedErrorBody {
  readonly success: false
  readonly error: {
    readonly kind: EmbedErrorKind
    readonly message: string
  }
}

// ---------------------------------------------------------------- 行为统计（T07）

/** 7 类埋点事件（与后端 track.types.ts 的 TRACK_EVENTS 一一对应） */
export type TrackEventName =
  'page_view' | 'search' | 'preview' | 'download' | 'ai_ask' | 'register' | 'feedback_submit'

/** 单条被拒事件的说明（后端逐条校验，前端只在排障时看它） */
export interface TrackIssue {
  readonly index: number
  readonly code: string
  readonly message: string
}

/** POST /api/track 成功响应 */
export interface TrackAcceptedResponse {
  readonly success: true
  readonly accepted: number
  readonly rejected: readonly TrackIssue[]
}

/** POST /api/track 失败响应 */
export interface TrackErrorBody {
  readonly success: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly issues: readonly TrackIssue[]
  }
}

/**
 * GET /api/admin/stats/summary 响应（P0 只有 curl/脚本消费；
 * T08 看板页会直接用它渲染，故类型先落在这里，形状不得偏离后端 track.types.ts）。
 */
export interface StatsSummaryResponse {
  readonly success: true
  readonly generatedAt: string
  readonly totals: {
    readonly events: number
    readonly pv: number
    readonly uv: number
    readonly registeredUsers: number
  }
  readonly events: Readonly<Record<TrackEventName, number>>
  readonly topSearchTerms: readonly { readonly term: string; readonly count: number }[]
  readonly zeroResultSearchTerms: readonly { readonly term: string; readonly count: number }[]
  /** 提问原文 Top10。历史行没有 term 时后端从 payload.question 回退。 */
  readonly topAskTerms: readonly { readonly term: string; readonly count: number }[]
  readonly topDownloads: readonly {
    readonly docId: string
    readonly fileName: string
    readonly count: number
  }[]
  readonly downloads: {
    /** T04 DownloadLog 行数（下载排行的权威口径） */
    readonly logRows: number
    /** EventLog download 事件数（前端埋点口径；与 logRows 不等 = 有接口被直连） */
    readonly events: number
  }
  readonly asks: {
    readonly total: number
    readonly judged: number
    readonly noAnswer: number
    readonly unjudged: number
    /** 无答案率 = noAnswer / judged */
    readonly noAnswerRate: number
  }
}
