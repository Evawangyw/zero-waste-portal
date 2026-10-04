// 前端 HTTP 通道：统一 baseURL / JSON 解析 / 401 识别 / 错误消息。
//
// baseURL 用**相对路径** `/api`：vite dev 已配 /api -> http://localhost:4000 代理，
// 生产 nginx 也把 /api 反代到自建后端，故前端代码里不出现任何后端地址（换环境不改代码）。
import type {
  AuthErrorBody,
  DocFileErrorBody,
  EmbedErrorBody,
  ShelfListResponse,
  ShelfFacetsResponse,
} from './types'

/** 统一错误：带 HTTP 状态与后端错误体，页面按 code/kind 分支 */
export class ApiError extends Error {
  readonly status: number
  /** 后端错误体（拿到就是结构化的，拿不到则 undefined） */
  readonly body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  /** 是否未登录/登录态失效（auth 与 docs 文件层都用 401 表示） */
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST'
  readonly query?: Readonly<Record<string, string | number | undefined>>
  readonly body?: unknown
  /** 登录态 JWT；传了就带 Authorization: Bearer */
  readonly token?: string | null
  /** 二进制下载（预览/下载）：拿到 Response 自行处理，不解析 JSON */
  readonly raw?: boolean
}

/** 拼查询串：空串/undefined 视为不传 */
function buildQuery(query: RequestOptions['query']): string {
  if (query === undefined) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token !== undefined && options.token !== null && options.token !== '') {
    headers['Authorization'] = `Bearer ${options.token}`
  }

  const response = await fetch(`/api${path}${buildQuery(options.query)}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  if (options.raw === true) {
    if (!response.ok) throw await toApiError(response)
    return response as unknown as T
  }

  const text = await response.text()
  const parsed: unknown = text === '' ? null : safeParse(text)
  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(parsed, response.status), parsed)
  }
  if (parsed === null) {
    throw new ApiError(response.status, '服务端返回了空响应')
  }
  return parsed as T
}

/** 失败响应 -> ApiError（优先用后端给的 message，其次用状态码兜底） */
async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  const parsed: unknown = text === '' ? null : safeParse(text)
  return new ApiError(response.status, extractMessage(parsed, response.status), parsed)
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 抽人话错误消息。
 * 三种后端错误体形状：auth 的 {error:{message}}、docs/embed 的 {error:{message}} —— 同构，
 * 另有 T01 透传通道可能直接回字符串。故逐个试，最后兜底成状态码文案。
 */
function extractMessage(parsed: unknown, status: number): string {
  const candidates = [asAuthError(parsed), asDocFileError(parsed), asEmbedError(parsed)]
  for (const candidate of candidates) {
    if (candidate !== null) return candidate
  }
  if (typeof parsed === 'string' && parsed.trim() !== '') return parsed
  return `请求失败（HTTP ${status}）`
}

function asAuthError(parsed: unknown): string | null {
  if (!isRecord(parsed) || !isRecord(parsed['error'])) return null
  const message = parsed['error']['message']
  return typeof message === 'string' && message !== '' ? message : null
}

function asDocFileError(parsed: unknown): string | null {
  if (!isRecord(parsed) || !isRecord(parsed['error'])) return null
  const message = parsed['error']['message']
  return typeof message === 'string' && message !== '' ? message : null
}

function asEmbedError(parsed: unknown): string | null {
  if (!isRecord(parsed) || !isRecord(parsed['error'])) return null
  const message = parsed['error']['message']
  return typeof message === 'string' && message !== '' ? message : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 书架/详情/凭证的类型守卫（避免各处重复 as） */
export const isShelfList = (value: unknown): value is ShelfListResponse =>
  isRecord(value) && value['success'] === true && Array.isArray(value['items'])

export const isShelfFacets = (value: unknown): value is ShelfFacetsResponse =>
  isRecord(value) && value['success'] === true && Array.isArray(value['types'])

export type { AuthErrorBody, DocFileErrorBody, EmbedErrorBody }
