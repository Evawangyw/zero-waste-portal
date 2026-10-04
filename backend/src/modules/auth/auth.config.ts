// 契约（模块内）：auth 模块配置 —— JWT 密钥只从 backend/.env 读，源码零字面量。
// 复用 T01 已导出的极简 .env 解析（只读引用，不改 weknora 模块）。
import { loadEnvFile } from '../../weknora/index.js'

/** PRD R01：登录态保持 >= 30 天 -> token 有效期 30 天 */
export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

/** bcrypt 计算代价：10 轮（生产可提到 12；10 在本机单次约 60-100ms，够用且不拖慢验收） */
export const BCRYPT_ROUNDS = 10

export interface AuthConfig {
  readonly jwtSecret: string
  readonly tokenTtlSeconds: number
}

/** 装配 auth 配置：JWT_SECRET 缺失直接抛错，绝不回落默认值（红线：密钥不进代码） */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const merged = env === process.env ? loadEnvFile(env) : env
  const jwtSecret = requireEnv('JWT_SECRET', merged)
  return {
    jwtSecret,
    tokenTtlSeconds: readPositiveInt(merged.JWT_TTL_SECONDS) ?? TOKEN_TTL_SECONDS,
  }
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少环境变量 ${name}，请在 backend/.env 中配置（禁止把密钥写进源码）。`)
  }
  return value.trim()
}

function readPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
