// 契约（ask 模块内）：百炼 Token Plan 的地址、模型和密钥只从 backend/.env 读。
import { loadEnvFile } from '../../weknora/index.js'

export interface BailianConfig {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

export function loadBailianConfig(env: NodeJS.ProcessEnv = process.env): BailianConfig {
  const merged = env === process.env ? loadEnvFile(env) : env
  return {
    apiKey: requireEnv('BAILIAN_API_KEY', merged),
    baseUrl: requireEnv('BAILIAN_BASE_URL', merged).replace(/\/+$/, ''),
    model: requireEnv('BAILIAN_MODEL', merged),
  }
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少环境变量 ${name}，请在 backend/.env 中配置（禁止把密钥写进源码）。`)
  }
  return value.trim()
}
