// 模块边界：embed（T06 挂件凭证交换）
// 契约：本文件是本模块对外数据形状的唯一真相来源，实现（config/service/router）都不得偏离。
//
// POST /api/embed/token            （卡片契约；Origin 必填且须命中白名单）
// GET  /api/embed/token            （同处理器的 GET 变体：官方 weknora-widget.js 的安全模式
//                                    loader 只会发 GET，二者共用一套校验与交换逻辑）
//   -> 200 EmbedTokenResponse
//   -> 403 { success:false, error:{ kind:'origin_not_allowed' } }   缺 Origin / Origin 不在白名单
//   -> 401 { success:false, error:{ kind:'login_required' } }        仅 REQUIRE_LOGIN_FOR_ASK=true
//   -> 502 { success:false, error:{ kind:'upstream_error' } }        WeKnora exchange 失败
//
// GET /api/embed/config             （**公开、非敏感**，给前端拼挂件 script 用）
//   -> 200 EmbedPublicConfigResponse（只含渠道 UUID / 挂件基址 / 定位参数，永不含 publish token）
//
// 硬约束：
//  - publish token（em_）只在后端 .env 与本进程内存中出现，**任何响应体、任何日志都不带它**；
//  - 下发给浏览器的只有 30 分钟短效 session token（ems_），且只在 Origin 命中白名单时才发。

/** 对外错误码（前端按 kind 分支，不解析 message 文案） */
export type EmbedErrorKind =
  /** 缺少 Origin 头，或 Origin 不在 WEKNORA_ALLOWED_ORIGINS 白名单里 */
  | 'origin_not_allowed'
  /** 仅 REQUIRE_LOGIN_FOR_ASK=true 时出现：无有效登录态 */
  | 'login_required'
  /** WeKnora exchange 侧失败（网络错 / 非 200 / 响应形状不对） */
  | 'upstream_error'
  | 'internal'

/** 出错时的统一响应体 */
export interface EmbedErrorResponse {
  readonly success: false
  readonly error: {
    readonly kind: EmbedErrorKind
    readonly message: string
  }
}

/**
 * 成功换取到 session token 的响应体。
 *
 * 形状刻意做双份，以同时满足三方消费者：
 *  - 官方挂件 loader：读 `data.token || data.session_token`、`data.expiresIn || data.expires_in`；
 *  - 任务卡：字段名 session_token / expires_in；
 *  - 人肉 curl 验收：顶层 token / expiresAt 一眼可见。
 * 三者取到的值完全一致，不存在第二份凭证。
 */
export interface EmbedTokenResponse {
  readonly success: true
  /** 短效会话令牌（ems_ 前缀，30 分钟过期）。与 data.session_token 同一个值 */
  readonly token: string
  /** 有效期秒数（WeKnora 返回 1800） */
  readonly expiresIn: number
  /** 过期时刻 ISO8601（本地按 expiresIn 推算，便于前端展示/排障） */
  readonly expiresAt: string
  /** 与 WeKnora 一致的信封层，供挂件 loader 直接消费 */
  readonly data: {
    readonly session_token: string
    readonly expires_in: number
  }
}

/** 挂件渲染所需的公开配置（无任何密钥） */
export interface EmbedWidgetPublicConfig {
  /** WeKnora 前端源（提供 /weknora-widget.js 与 /embed/{channelId}），如 http://localhost */
  readonly baseUrl: string
  /** 渠道 UUID：非密钥，公开可见（它就在 iframe 的 URL 里） */
  readonly channelId: string
  /** 前端挂 script 时指向的凭证接口（后端自己，同源代理时为 /api/embed/token） */
  readonly tokenEndpoint: string
  /** 悬浮球位置：bottom-right | bottom-left | top-right | top-left */
  readonly position: string
  /** 挂件标题 */
  readonly title: string
  /** 是否已开启「提问必须登录」（前端据此提示先登录） */
  readonly requireLoginForAsk: boolean
  /** 白名单 Origin 列表（供前端排障展示，非敏感） */
  readonly allowedOrigins: readonly string[]
}

export interface EmbedPublicConfigResponse {
  readonly success: true
  readonly widget: EmbedWidgetPublicConfig
}
