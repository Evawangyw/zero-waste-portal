// 契约（模块边界：auth · T02 注册登录）
//
// HTTP 契约（app.ts 只挂 authRouter，不改其他模块）：
//   POST /api/auth/register -> 201 { success:true, user:PublicUser }
//                            | 400 { success:false, error:{ code:'VALIDATION_FAILED', message, fields:FieldIssue[] } }
//                            | 409 { success:false, error:{ code:'PHONE_TAKEN', ... } }
//   POST /api/auth/login    -> 200 { success:true, token, tokenType:'Bearer', expiresIn, expiresAt, user }
//                            | 400 参数缺失/非法
//                            | 401 { code:'INVALID_CREDENTIALS' }
//   GET  /api/auth/me       -> 200 { success:true, user:PublicUser }   （requireAuth 守卫）
//                            | 401 无 token / token 失效
//
// 边界：本模块只管自建用户体系，与 WeKnora 账号完全隔离。
// 「需登录动作」（下载 / 提问）的守卫见 requireAuth，本卡只导出不接线（T04/T06 用）。
// 验收：见 docs/task-cards/T02-注册登录.md 六条。

/** 对外错误码（前端按 code 分支，不解析 message 文案） */
export type AuthErrorCode =
  | 'VALIDATION_FAILED'
  | 'PHONE_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'AUTH_REQUIRED'
  | 'INVALID_TOKEN'
  | 'USER_GONE'
  | 'INTERNAL_ERROR'

/** 单字段校验失败明细（验收①要求：报错必须指明缺哪个字段） */
export interface FieldIssue {
  readonly field: string
  readonly message: string
}

/** 出错时的统一响应体 */
export interface AuthErrorBody {
  readonly success: false
  readonly error: {
    readonly code: AuthErrorCode
    readonly message: string
    /** 字段级明细；非参数类错误（如 PHONE_TAKEN / INTERNAL_ERROR）为空数组 */
    readonly fields: readonly FieldIssue[]
  }
}

/** 用户对外视图：**永不含 passwordHash**（验收①：不得泄漏密码哈希） */
export interface PublicUser {
  readonly id: string
  readonly name: string
  readonly org: string
  readonly occupation: string
  /** 关注议题（多选数组；落库为 JSON 串，读出已 parse） */
  readonly topics: readonly string[]
  readonly phone: string
  readonly isAdmin: boolean
  /** ISO8601 字符串 */
  readonly createdAt: string
}

/** POST /api/auth/register 请求体（校验通过后的形态） */
export interface RegisterBody {
  readonly name: string
  readonly org: string
  readonly occupation: string
  readonly topics: readonly string[]
  readonly phone: string
  readonly password: string
  /** 隐私提示勾选同意，PRD R01 要求必须为 true */
  readonly consent: true
}

export interface RegisterResponse {
  readonly success: true
  readonly user: PublicUser
}

/** POST /api/auth/login 请求体 */
export interface LoginBody {
  readonly phone: string
  readonly password: string
}

export interface LoginResponse {
  readonly success: true
  /** JWT（HS256），前端放 Authorization: Bearer <token> */
  readonly token: string
  readonly tokenType: 'Bearer'
  /** 有效期秒数（30 天 = 2592000，PRD R01：登录态保持 >= 30 天） */
  readonly expiresIn: number
  /** 过期时刻 ISO8601 */
  readonly expiresAt: string
  readonly user: PublicUser
}

export interface MeResponse {
  readonly success: true
  readonly user: PublicUser
}

/** requireAuth 成功后放进 res.locals.auth 的登录态（T04/T06 从这里拿 userId） */
export interface AuthContext {
  readonly userId: string
  readonly phone: string
}

/** Express res.locals 的类型增量（不用 declare global，避免污染全项目 Request 类型） */
export interface AuthLocals {
  auth?: AuthContext | undefined
}
