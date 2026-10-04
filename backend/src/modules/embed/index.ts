// 模块边界：embed —— 对外唯一出口（T06）
// 挂载点（src/app.ts）：app.use(embedRouter) —— 本卡动 app.ts 的唯一理由。
// 铁律同其他模块：全项目只允许从本文件 import 本模块，禁止绕过它直连 embed.service / embed.config。
export { embedRouter } from './embed.router.js'
export type { EmbedResponse, EmbedResponseBody } from './embed.router.js'

export { EmbedError } from './embed.error.js'

export {
  DEFAULT_REQUIRE_LOGIN_FOR_ASK,
  WIDGET_POSITIONS,
  loadEmbedConfig,
  normalizeOrigin,
  readOrigins,
} from './embed.config.js'
export type { EmbedConfig, WidgetPosition } from './embed.config.js'

export {
  assertOriginAllowed,
  buildTokenResponse,
  buildWidgetConfig,
  exchangeSessionToken,
  isSameOriginBrowserFetch,
  reconstructRequestOrigin,
} from './embed.service.js'
export type { SessionToken } from './embed.service.js'

export type {
  EmbedErrorKind,
  EmbedErrorResponse,
  EmbedPublicConfigResponse,
  EmbedTokenResponse,
  EmbedWidgetPublicConfig,
} from './embed.types.js'
