// 契约（模块内）：embed 模块配置 —— 全部只从 backend/.env 读，源码零密钥字面量。
// 复用 weknora 模块导出的极简 .env 解析（只读引用，不改 weknora 模块）。
import { loadEnvFile } from '../../weknora/index.js'

/**
 * Q1 开关（任务卡明写）：REQUIRE_LOGIN_FOR_ASK=false 默认关。
 * false -> 任何人可换 session token（公众免登录提问，与 PRD R01 首屏一致）；
 * true  -> 挂 requireAuth，缺登录态 401（黄老师拍板后只改 .env 一行，不改代码）。
 */
export const DEFAULT_REQUIRE_LOGIN_FOR_ASK = false

/** 挂件位置合法值（与 WeKnora 渠道字段同枚举） */
export const WIDGET_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const

export type WidgetPosition = (typeof WIDGET_POSITIONS)[number]

export interface EmbedConfig {
  /** WeKnora Go API 基址（exchange 打这里），如 http://localhost:8080 */
  readonly baseUrl: string
  /** 渠道 UUID（非密钥） */
  readonly channelId: string
  /** 发布令牌 em_（密钥）：只在后端内存，绝不下发 */
  readonly publishToken: string
  /** 允许嵌入的业务宿主 Origin 列表（精确匹配） */
  readonly allowedOrigins: readonly string[]
  /** 挂件前端源（提供 /weknora-widget.js 与 /embed/{channelId}） */
  readonly widgetBaseUrl: string
  readonly widgetPosition: WidgetPosition
  readonly widgetTitle: string
  /** 挂件换 token 的对外路径（前端按同源代理访问） */
  readonly tokenEndpointPath: string
  readonly requireLoginForAsk: boolean
  /** exchange 超时（毫秒） */
  readonly timeoutMs: number
}

/**
 * 装配 embed 配置。
 * WEKNORA_WIDGET_BASE_URL 缺省回落成 baseUrl —— 因为很多部署里 API 与前端同源；
 * 本机实测二者不同源（API 8080 只有 API，静态挂件在 80），故 .env 里显式写了一行。
 */
export function loadEmbedConfig(env: NodeJS.ProcessEnv = process.env): EmbedConfig {
  const merged = env === process.env ? loadEnvFile(env) : env
  const baseUrl = requireEnv('WEKNORA_BASE_URL', merged).replace(/\/+$/, '')
  return {
    baseUrl,
    channelId: requireEnv('WEKNORA_CHANNEL_ID', merged),
    publishToken: requireEnv('WEKNORA_PUBLISH_TOKEN', merged),
    allowedOrigins: readOrigins(merged['WEKNORA_ALLOWED_ORIGINS']),
    widgetBaseUrl: readNonEmpty(merged['WEKNORA_WIDGET_BASE_URL']) ?? baseUrl,
    widgetPosition: readPosition(merged['WEKNORA_WIDGET_POSITION']),
    widgetTitle: readNonEmpty(merged['WEKNORA_WIDGET_TITLE']) ?? '零废弃知识库助手',
    tokenEndpointPath: readNonEmpty(merged['EMBED_TOKEN_ENDPOINT_PATH']) ?? '/api/embed/token',
    requireLoginForAsk: readBool(merged['REQUIRE_LOGIN_FOR_ASK']) ?? DEFAULT_REQUIRE_LOGIN_FOR_ASK,
    timeoutMs: readInt(merged['EMBED_TOKEN_TIMEOUT_MS'], 1) ?? 15_000,
  }
}

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少环境变量 ${name}，请在 backend/.env 中配置（禁止把密钥写进源码）。`)
  }
  return value.trim()
}

function readNonEmpty(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 逗号分隔的 Origin 列表。归一化规则：小写 + 去尾部斜杠。
 * 只做精确匹配（不实现 *.example.com 通配）——白名单是我们自己在 .env 里逐条列的，
 * 语义越窄越安全；真要通配必须先把 WeKnora 侧 allowed_origins 也配上，两边不一致会 403。
 */
export function readOrigins(raw: string | undefined): readonly string[] {
  const value = readNonEmpty(raw)
  if (value === undefined) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of value.split(',')) {
    const normalized = normalizeOrigin(piece)
    if (normalized === '' || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/** Origin 归一化：trim + 小写 + 去尾部 '/'；空串返回 '' */
export function normalizeOrigin(raw: string | undefined): string {
  const value = readNonEmpty(raw)
  if (value === undefined) return ''
  return value.toLowerCase().replace(/\/+$/, '')
}

function readPosition(raw: string | undefined): WidgetPosition {
  const value = readNonEmpty(raw)?.toLowerCase()
  if (value !== undefined && (WIDGET_POSITIONS as readonly string[]).includes(value)) {
    return value as WidgetPosition
  }
  return 'bottom-right'
}

function readBool(raw: string | undefined): boolean | undefined {
  const value = readNonEmpty(raw)?.toLowerCase()
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return true
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') return false
  return undefined
}

function readInt(raw: string | undefined, min: number): number | undefined {
  if (readNonEmpty(raw) === undefined) return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= min ? n : undefined
}
