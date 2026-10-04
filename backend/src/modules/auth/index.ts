// 模块边界：auth —— 对外唯一出口（T02）
// 铁律同 weknora：全项目只允许从本文件 import 本模块，禁止绕过它直连 auth.service / auth.jwt。
//
// 挂载点（src/app.ts）：app.use(authRouter) —— 本卡动 app.ts 的唯一理由。
// 守卫导出：requireAuth / getAuthContext / AuthError 供 T04（下载）、T06（提问）接线，本卡不接线。
export { authRouter } from './auth.router.js'

// 登录守卫（T04/T06 用；本卡只用于保护 GET /api/auth/me）
export { getAuthContext, requireAuth } from './auth.middleware.js'
export type { AuthHandler, AuthRequest } from './auth.middleware.js'

// 业务错误（T04/T06 可捕获后转自己的响应体）
export { AuthError } from './auth.service.js'

// 配置常量（token 有效期等，前端展示登录有效期时可能要用）
export { BCRYPT_ROUNDS, TOKEN_TTL_SECONDS } from './auth.config.js'
export type { AuthConfig } from './auth.config.js'

// 类型契约
export type {
  AuthContext,
  AuthErrorBody,
  AuthErrorCode,
  AuthLocals,
  FieldIssue,
  LoginBody,
  LoginResponse,
  MeResponse,
  PublicUser,
  RegisterBody,
  RegisterResponse,
} from './auth.types.js'
