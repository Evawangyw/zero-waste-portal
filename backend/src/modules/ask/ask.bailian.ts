// 契约（ask 模块内）：百炼地址、模型和密钥优先用系统设置，没有再读 backend/.env。
import { loadEnvFile } from '../../weknora/index.js'
import { peekAskSettings } from '../settings/settings.store.js'

export interface BailianConfig {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

export function loadBailianConfig(env: NodeJS.ProcessEnv = process.env): BailianConfig {
  const merged = env === process.env ? loadEnvFile(env) : env
  const saved = peekAskSettings()
  const apiKey = saved.bailianApiKey !== '' ? saved.bailianApiKey : requireEnv('BAILIAN_API_KEY', merged)
  const baseUrl = (saved.bailianBaseUrl !== '' ? saved.bailianBaseUrl : requireEnv('BAILIAN_BASE_URL', merged)).replace(
    /\/+$/,
    '',
  )
  const model = saved.bailianModel !== '' ? saved.bailianModel : requireEnv('BAILIAN_MODEL', merged)
  return { apiKey, baseUrl, model }
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少环境变量 ${name}，请在 backend/.env 中配置（禁止把密钥写进源码）。`)
  }
  return value.trim()
}
