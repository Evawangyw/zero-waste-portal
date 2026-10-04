// 契约（模块内）：从 backend/.env 读取 WeKnora 配置
// 红线：密钥只从环境变量读，源码里不得出现任何 key 字面量。
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { WeKnoraConfig } from './types.js'

/** 任务卡规定：非流式默认超时 15s */
export const DEFAULT_TIMEOUT_MS = 15_000
/** 任务卡规定：GET 幂等重试 2 次（即最多 3 次尝试） */
export const DEFAULT_RETRIES = 2
/** SSE 默认总时长上限（长回答兜底；不与 15s 非流式超时混用） */
export const DEFAULT_SSE_TIMEOUT_MS = 180_000

/**
 * 定位 backend/.env。
 * 不用 import.meta.url：backend/package.json 未设 "type":"module"，tsconfig.build.json 按 CJS 出包，
 * 用 import.meta 会触发 tsc TS1470（CommonJS 不允许 import.meta）。改从 cwd 找：
 * 先 <cwd>/.env（npm workspace 脚本的 cwd 就是 backend/），再 <cwd>/backend/.env（从仓库根直接跑 tsx 时）。
 */
export function resolveEnvFilePath(cwd: string = process.cwd()): string | null {
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, 'backend', '.env')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * 极简 .env 解析（仅 KEY=VALUE，忽略 # 注释与空行，支持成对引号包裹）。
 * 为什么手写不用 dotenv：dotenv 当前只是 prisma 的传递依赖，未在 backend/package.json 里声明，
 * 直接 import 等于依赖幽灵包（换 npm 版本/裁剪依赖就崩）。零新增依赖更稳。
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    if (quoted) value = value.slice(1, -1)
    if (key !== '') out[key] = value
  }
  return out
}

/** 把 backend/.env 灌进 process.env（已存在的键不覆盖，进程环境优先） */
export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const path = resolveEnvFilePath()
  if (path === null) return env
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
    if (env[key] === undefined) env[key] = value
  }
  return env
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少环境变量 ${name}，请在 backend/.env 中配置（禁止把密钥写进源码）。`)
  }
  return value.trim()
}

/** 装配对接层配置：缺失必需变量直接抛错，不给默认值蒙混过关 */
export function loadWeKnoraConfig(env: NodeJS.ProcessEnv = process.env): WeKnoraConfig {
  const merged = env === process.env ? loadEnvFile(env) : env
  return {
    baseUrl: requireEnv('WEKNORA_BASE_URL', merged).replace(/\/+$/, ''),
    apiKey: requireEnv('WEKNORA_API_KEY', merged),
    knowledgeBaseId: requireEnv('WEKNORA_KB_ID', merged),
    timeoutMs: readInt(merged.WEKNORA_TIMEOUT_MS, 1) ?? DEFAULT_TIMEOUT_MS,
    retries: readInt(merged.WEKNORA_RETRIES, 0) ?? DEFAULT_RETRIES,
  }
}

function readInt(raw: string | undefined, min: number): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= min ? n : undefined
}
