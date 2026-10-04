// 契约（模块内）：登录守卫中间件
//
// requireAuth：校验 Authorization: Bearer <JWT> -> 把登录态放进 res.locals.auth -> next()。
// 本卡只用它保护 GET /api/auth/me；**「需登录动作」（下载 / 提问）的守卫已导出但本卡不接线**
// （T04/T06 按 AGENTS.md 铁律自行在自己模块内挂载）。
import type { Request, RequestHandler } from 'express'
// ParamsDictionary / Query（= ParsedQs）在 @types/express 4.17 里不再从 express 转出，
// 直接取源包（纯类型 import，零运行时依赖）。
import type { ParamsDictionary, Query } from 'express-serve-static-core'
import { loadAuthConfig } from './auth.config.js'
import { verifyAuthToken } from './auth.jwt.js'
import { AuthError, findUserById } from './auth.service.js'
import { respondAuthError } from './auth.respond.js'
import type { AuthResponse, AuthResBody } from './auth.respond.js'
import type { AuthContext, AuthLocals } from './auth.types.js'

/** auth 模块统一的处理器类型（登录态类型化，避免 any 逃逸） */
export type AuthRequest = Request<ParamsDictionary, AuthResBody, unknown, Query, AuthLocals>
export type AuthHandler = RequestHandler<ParamsDictionary, AuthResBody, unknown, Query, AuthLocals>

/**
 * 登录守卫。无 token / token 失效 / 用户已不存在 -> 401（验收④）。
 * 成功后 res.locals.auth = { userId, phone }，业务处理器用 getAuthContext(res) 取。
 */
export const requireAuth: AuthHandler = (req, res, next): void => {
  void guard(req, res, next)
}

async function guard(
  req: AuthRequest,
  res: AuthResponse,
  next: (err?: unknown) => void,
): Promise<void> {
  try {
    const token = readBearerToken(req.headers.authorization)
    if (token === null) {
      throw new AuthError({
        code: 'AUTH_REQUIRED',
        status: 401,
        message: '缺少登录态：请在 Authorization 头带 Bearer <token>',
      })
    }
    const payload = verifyAuthToken(token, loadAuthConfig())
    if (payload === null) {
      throw new AuthError({
        code: 'INVALID_TOKEN',
        status: 401,
        message: '登录态无效或已过期，请重新登录',
      })
    }
    // 校验用户仍在库（被删/被清库的 token 立即失效），顺带给下游新鲜的用户信息
    const user = await findUserById(payload.sub)
    if (user === null) {
      throw new AuthError({ code: 'USER_GONE', status: 401, message: '账号不存在，请重新登录' })
    }
    res.locals.auth = { userId: user.id, phone: user.phone }
    next()
  } catch (err) {
    respondAuthError(res, err)
  }
}

/**
 * 从 res.locals 取登录态。
 * 供 T04/T06：挂在 requireAuth 之后的处理器里读不到登录态就说明守卫没挂。
 */
export function getAuthContext(res: { readonly locals: AuthLocals }): AuthContext | null {
  return res.locals.auth ?? null
}

/** 解析 Authorization 头：只认 `Bearer <token>`（大小写不敏感），其余一律视为未登录 */
function readBearerToken(header: string | undefined): string | null {
  if (typeof header !== 'string') return null
  const parts = header.trim().split(/\s+/)
  const [scheme, token, ...rest] = parts
  if (rest.length > 0) return null
  if (scheme === undefined || token === undefined) return null
  if (scheme.toLowerCase() !== 'bearer') return null
  return token === '' ? null : token
}
