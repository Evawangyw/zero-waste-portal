// 契约（模块内）：JWT 签发与校验（HS256）
// 密钥来自 backend/.env（经 loadAuthConfig 注入），本文件不出现任何密钥字面量。
import jwt from 'jsonwebtoken'
import type { AuthConfig } from './auth.config.js'

/** token 载荷：sub = userId，phone 便于日志排查（不含密码/哈希） */
export interface TokenPayload {
  readonly sub: string
  readonly phone: string
}

export interface SignedToken {
  readonly token: string
  /** 过期时刻 ISO8601 */
  readonly expiresAt: string
}

/** 只接受 HS256，避免 alg=none / RS256 混淆类攻击 */
const ALGORITHM = 'HS256' as const
const ALGORITHMS: readonly jwt.Algorithm[] = [ALGORITHM]

/** 签发 token；有效期取配置（默认 30 天，满足 PRD R01） */
export function signAuthToken(payload: TokenPayload, config: AuthConfig): SignedToken {
  const token = jwt.sign({ phone: payload.phone }, config.jwtSecret, {
    algorithm: ALGORITHM,
    subject: payload.sub,
    expiresIn: config.tokenTtlSeconds,
  })
  return {
    token,
    expiresAt: new Date(Date.now() + config.tokenTtlSeconds * 1000).toISOString(),
  }
}

/**
 * 校验 token。
 * 任何异常（格式错 / 签名不符 / 过期 / 载荷缺字段）一律返回 null —— 由调用方决定报 401 的哪种 code，
 * 避免把 jwt 的原始错误文案泄露给前端。
 */
export function verifyAuthToken(token: string, config: AuthConfig): TokenPayload | null {
  try {
    const decoded: unknown = jwt.verify(token, config.jwtSecret, { algorithms: [...ALGORITHMS] })
    return toPayload(decoded)
  } catch {
    return null
  }
}

/** 载荷收窄：只认 { sub:string, phone:string }，其余（含纯字符串载荷）一律判无效 */
function toPayload(decoded: unknown): TokenPayload | null {
  if (typeof decoded !== 'object' || decoded === null) return null
  const claims = decoded as { readonly sub?: unknown; readonly phone?: unknown }
  const { sub, phone } = claims
  if (typeof sub !== 'string' || sub === '') return null
  if (typeof phone !== 'string' || phone === '') return null
  return { sub, phone }
}
