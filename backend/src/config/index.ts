// 零废弃知识库 · 自建后端配置
// 密钥一律来自 backend/.env（gitignore，永不进仓库），此处只放非密钥的运行参数。
import type { LogLevel } from './log-level.js'

export interface AppConfig {
  readonly nodeEnv: 'development' | 'production' | 'test'
  readonly port: number
  readonly logLevel: LogLevel
  readonly dbUrl: string
}

export const DEFAULT_PORT = 4000

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PORT 非法：${raw}（应为 1-65535 的整数）`)
  }
  return parsed
}

function parseNodeEnv(raw: string | undefined): AppConfig['nodeEnv'] {
  if (raw === 'production' || raw === 'test') return raw
  return 'development'
}

/**
 * 从环境变量装配配置。
 * 注意：WEKNORA_API_KEY / JWT_SECRET 等密钥由 T01 及以后卡片读取，本卡（空壳）不碰。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    port: parsePort(env.PORT),
    logLevel: 'info',
    dbUrl: env.DB_URL ?? 'file:./data/app.db',
  }
}
