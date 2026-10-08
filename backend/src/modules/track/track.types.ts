// 契约（模块边界：track · T07 行为统计落库）
//
// 本文件是 track 模块对外数据形状的唯一真相来源；
// 实现（validate / repo / answer / stats / admin / router）都不得偏离。
// 完整口径见 docs/task-cards/T07-契约.md。
//
// 路由契约：
//   POST /api/track
//     单条 / 裸数组 / { events: [...] } 三种信封都收；匿名可传（userId 缺省 = null）
//     -> 201 { success:true, accepted:number, rejected:TrackIssue[] }   （允许部分成功）
//     -> 400 { success:false, error:{ code, message, issues:TrackIssue[] } }
//   GET /api/admin/stats/summary
//     守卫：X-Admin-Token（ADMIN_STATS_TOKEN 环境变量）**或** isAdmin 用户的 JWT
//     -> 200 StatsSummaryResponse
//     -> 401 无/失效登录态（由 auth 模块守卫给出）| 403 已登录但非管理员
//     -> 500 统计查询失败
//
// 边界：本模块只读 auth 的 users.isAdmin（判断管理员），不读写 auth/weknora 任何其他数据；
//      不改 T02/T03/T04/T05T06 任何既有行为（download 走「双写」，见契约 §6）。

/** 事件白名单（任务卡原文 7 类）；不在表内的单条事件一律拒绝，不产生脏数据 */
export const TRACK_EVENTS = [
  'page_view',
  'search',
  'preview',
  'download',
  'ai_ask',
  'register',
  'feedback_submit',
] as const

export type TrackEvent = (typeof TRACK_EVENTS)[number]

/** 单次请求最多收多少条（超了整批 400，防"一次 POST 灌十万条"） */
export const TRACK_MAX_EVENTS_PER_REQUEST = 100

/** payload 序列化后的字符数上限（保护 SQLite 行宽与看板可读性） */
export const TRACK_MAX_PAYLOAD_CHARS = 4000

/** sessionId 上限；超出按截断处理（非拒绝，匿名访客不该因为会话串太长而丢数据） */
export const TRACK_MAX_SESSION_ID_CHARS = 64

/** userId 上限；超出截断 */
export const TRACK_MAX_USER_ID_CHARS = 64

/** path（页面来源）上限；超出截断 */
export const TRACK_MAX_PATH_CHARS = 512

/** 检索词上限（派生列 term）；超出截断 */
export const TRACK_MAX_TERM_CHARS = 100

/** 校验/拒绝原因码（前端与验收脚本按 code 分支，不解析 message 文案） */
export type TrackIssueCode =
  | 'INVALID_BODY'
  | 'EMPTY_BATCH'
  | 'TOO_MANY_EVENTS'
  | 'INVALID_ITEM'
  | 'UNKNOWN_EVENT'
  | 'PAYLOAD_TOO_LARGE'
  | 'ALL_REJECTED'

/** 单条被拒（或整批被拒）的原因；index 是它在批次里的下标（信封级错误恒为 0） */
export interface TrackIssue {
  readonly index: number
  readonly code: TrackIssueCode
  readonly message: string
}

/** POST /api/track 成功响应（accepted == 实际落库行数，验收①） */
export interface TrackAcceptedResponse {
  readonly success: true
  readonly accepted: number
  readonly rejected: readonly TrackIssue[]
}

/** POST /api/track 失败响应 */
export interface TrackErrorResponse {
  readonly success: false
  readonly error: {
    readonly code: 'VALIDATION_FAILED' | 'INTERNAL_ERROR' | 'BAD_REQUEST'
    readonly message: string
    readonly issues: readonly TrackIssue[]
  }
}

/** 校验通过、可以直接写库的单条事件（已归一化：长度截断、term 小写化、noAnswer 已判定） */
export interface TrackEventInput {
  readonly event: TrackEvent
  /** null = 匿名访客 */
  readonly userId: string | null
  readonly sessionId: string
  readonly path: string
  /** 已序列化的 JSON 串（保证是普通对象序列化来的） */
  readonly payload: string
  /** 派生列：search 检索词 */
  readonly term: string
  /** 派生列：ai_ask 无答案判定；null = 未判定 */
  readonly noAnswer: boolean | null
  /** 派生列：search 零结果 */
  readonly zeroResult: boolean
}

// ------------------------------------------------------------------ 统计

/** 检索词计数（Top10 / 零结果词共用） */
export interface SearchTermCount {
  readonly term: string
  readonly count: number
}

/** 下载排行条目（读 download_logs；fileName 即 T04 下发给浏览器的重命名文件名） */
export interface DownloadTopItem {
  readonly docId: string
  readonly fileName: string
  readonly count: number
}

/** 提问统计（无答案率口径见契约 §4） */
export interface AsksSummary {
  /** ai_ask 事件总数 */
  readonly total: number
  /** 有回答证据、可判定的条数（noAnswer IS NOT NULL） */
  readonly judged: number
  /** 判定为无答案的条数 */
  readonly noAnswer: number
  /** 未判定条数（前端没上报回答证据，如直接在官方挂件面板里打字） */
  readonly unjudged: number
  /** 无答案率 = noAnswer / judged（judged=0 时为 0） */
  readonly noAnswerRate: number
}

/** GET /api/admin/stats/summary 响应 */
export interface StatsSummaryResponse {
  readonly success: true
  /** 生成时刻 ISO8601 */
  readonly generatedAt: string
  readonly totals: {
    /** event_logs 总行数 */
    readonly events: number
    /** PV = page_view 事件条数 */
    readonly pv: number
    /** UV = 全事件按 COALESCE(userId, sessionId) 去重的访客数 */
    readonly uv: number
    /** users 表总行数（注册数；register 事件只作交叉验证） */
    readonly registeredUsers: number
  }
  /** 各事件计数（未发生的给 0，前端不用判空） */
  readonly events: Readonly<Record<TrackEvent, number>>
  readonly topSearchTerms: readonly SearchTermCount[]
  readonly zeroResultSearchTerms: readonly SearchTermCount[]
  /** 提问原文 Top10（ai_ask 的 term；历史行没有 term 时从 payload.question 回退） */
  readonly topAskTerms: readonly SearchTermCount[]
  /** 下载 Top10（权威口径 = T04 的 download_logs） */
  readonly topDownloads: readonly DownloadTopItem[]
  readonly downloads: {
    /** download_logs 行数 */
    readonly logRows: number
    /** event_logs 里 download 事件数（前端埋点口径；两者不等 = 有绕过前端的直连调用） */
    readonly events: number
  }
  readonly asks: AsksSummary
}

/** 统计层错误码 */
export type StatsErrorKind = 'internal'

/** 统计层错误体 */
export interface StatsErrorResponse {
  readonly success: false
  readonly error: {
    readonly kind: StatsErrorKind
    readonly message: string
  }
}
