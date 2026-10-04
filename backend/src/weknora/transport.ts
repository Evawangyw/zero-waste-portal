// 契约（模块内）：HTTP 传输层 —— 统一超时 / 重试 / 错误分类
// 规则（任务卡）：
//  - 超时：非流式默认 15s（AbortController）
//  - 重试：仅 GET（幂等）重试 2 次，指数退避；5xx/429/网络错才重试，4xx 业务错不重试
//  - 错误：全部收敛为 WeKnoraError，携带 kind/status/path/retryable
import { classifyStatus, messageForKind, snippet, WeKnoraError } from './errors.js'
import type { WeKnoraErrorKind } from './types.js'

export interface TransportOptions {
  readonly baseUrl: string
  readonly apiKey: string
  readonly timeoutMs: number
  readonly retries: number
}

export interface RequestSpec {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly query?: Readonly<Record<string, string | number | undefined>> | undefined
  readonly body?: unknown
  /** 覆盖默认超时（下载大文件用） */
  readonly timeoutMs?: number | undefined
  /** 外部取消信号（如客户端断开） */
  readonly signal?: AbortSignal | undefined
}

export interface TextResponse {
  readonly status: number
  readonly text: string
}

const RETRY_BASE_DELAY_MS = 300
const RETRY_MAX_DELAY_MS = 2_000

/** 组装 URL（自动处理 base 斜杠与 query 编码） */
export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Readonly<Record<string, string | number | undefined>>,
): string {
  const base = baseUrl.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  const url = new URL(base + suffix)
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

/** 认证头：WeKnora 固定 X-API-Key（主控实测） */
function authHeaders(apiKey: string): Record<string, string> {
  return { 'X-API-Key': apiKey, Accept: 'application/json' }
}

/** 发一个 GET（幂等，自动重试），返回原始 Response 由调用方决定读 json/text/stream */
export async function requestText(
  transport: TransportOptions,
  spec: RequestSpec,
): Promise<TextResponse> {
  const { response, path } = await sendWithRetry(transport, spec, true)
  return { status: response.status, text: await readBodyText(response, path) }
}

/** 发一个 POST（不自动重试，避免重复写 WeKnora 侧数据） */
export async function requestJson(
  transport: TransportOptions,
  spec: RequestSpec,
): Promise<unknown> {
  const { response, path } = await sendWithRetry(transport, spec, false)
  const text = await readBodyText(response, path)
  return parseJsonSafe(text, path)
}

/** 发一个 POST 但保留原始流（download / SSE 用，不读 body、不设 15s 超时） */
export async function requestStream(
  transport: TransportOptions,
  spec: RequestSpec,
): Promise<{ response: Response; path: string }> {
  return sendRaw(transport, spec, false)
}

/**
 * 核心发送逻辑：带 AbortController 超时 + GET 幂等重试。
 * retries 仅在 idempotent=true 时生效（任务卡：GET 重试 2 次）。
 */
async function sendWithRetry(
  transport: TransportOptions,
  spec: RequestSpec,
  idempotent: boolean,
): Promise<{ response: Response; path: string }> {
  const maxAttempts = idempotent ? transport.retries + 1 : 1
  let lastError: WeKnoraError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await sendRaw(transport, spec, idempotent)
    } catch (err) {
      const error = WeKnoraError.from(err, spec.path)
      lastError = error
      const canRetry = idempotent && error.retryable && attempt < maxAttempts
      if (!canRetry) throw error
      await sleep(retryDelay(attempt))
    }
  }
  // 理论上不可达（循环内必 return 或 throw），此处兜底保证类型收窄
  throw lastError ?? new WeKnoraError({
    kind: 'network',
    message: `调用 WeKnora 失败（${spec.path}）：重试耗尽`,
    path: spec.path,
    retryable: false,
  })
}

/** 单次发送（不含重试）：负责注入超时/取消信号、判状态码、拼错误 */
async function sendRaw(
  transport: TransportOptions,
  spec: RequestSpec,
  idempotent: boolean,
): Promise<{ response: Response; path: string }> {
  const url = buildUrl(transport.baseUrl, spec.path, spec.query)
  const timeoutMs = spec.timeoutMs ?? transport.timeoutMs
  const controller = new AbortController()
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort()
        }, timeoutMs)
      : null

  const onExternalAbort = (): void => {
    controller.abort()
  }
  if (spec.signal !== undefined) {
    if (spec.signal.aborted) controller.abort()
    else spec.signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  const headers = authHeaders(transport.apiKey)
  const init: RequestInit = {
    method: spec.method,
    headers: spec.body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    signal: controller.signal,
  }
  if (spec.body !== undefined) init.body = JSON.stringify(spec.body)

  try {
    const response = await fetch(url, init)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const { kind, retryable } = classifyStatus(response.status)
      throw new WeKnoraError({
        kind,
        message: messageForKind(kind, response.status),
        path: spec.path,
        status: response.status,
        // 4xx 业务错对幂等 GET 重试也无意义，只有瞬时错才重试
        retryable: retryable && (idempotent || kind === 'rate_limited' || kind === 'server_error'),
        responseSnippet: snippet(text),
      })
    }
    return { response, path: spec.path }
  } catch (err) {
    throw toTransportError(err, spec.path, timeoutMs, idempotent)
  } finally {
    if (timer !== null) clearTimeout(timer)
    if (spec.signal !== undefined) spec.signal.removeEventListener('abort', onExternalAbort)
  }
}

/** fetch 层异常 -> WeKnoraError（AbortError 归为 timeout） */
function toTransportError(
  err: unknown,
  path: string,
  timeoutMs: number,
  idempotent: boolean,
): WeKnoraError {
  if (err instanceof WeKnoraError) return err
  const isAbort =
    err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
  const kind: WeKnoraErrorKind = isAbort ? 'timeout' : 'network'
  return new WeKnoraError({
    kind,
    message: messageForKind(kind, undefined) + (isAbort ? `（${timeoutMs}ms）` : ''),
    path,
    retryable: idempotent, // 网络错/超时对 GET 值得重试
    cause: err,
  })
}

async function readBodyText(response: Response, path: string): Promise<string> {
  try {
    return await response.text()
  } catch (err) {
    throw new WeKnoraError({
      kind: 'network',
      message: '读取 WeKnora 响应体失败（连接可能中途断开）',
      path,
      retryable: false,
      cause: err,
    })
  }
}

/** 解析 JSON：失败归为 parse_error，附带片段便于排障 */
function parseJsonSafe(text: string, path: string): unknown {
  if (text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new WeKnoraError({
      kind: 'parse_error',
      message: 'WeKnora 响应不是合法 JSON',
      path,
      retryable: false,
      responseSnippet: snippet(text),
      cause: err,
    })
  }
}

/** 指数退避（带上限），第 n 次重试等待 base * 2^(n-1) */
function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
