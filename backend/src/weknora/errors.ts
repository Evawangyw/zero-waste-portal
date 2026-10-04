// 契约（模块内）：WeKnora 统一错误分类
// 全项目任何对接层调用失败，一律抛 WeKnoraError，调用方按 kind 分支，不去猜 fetch 原生错误。
import type { WeKnoraErrorKind, WeKnoraErrorInit } from './types.js'

/** 对接层唯一错误类型。cause 保留底层信息（网络错等），便于日志排查。 */
export class WeKnoraError extends Error {
  /** 错误分类：路由层据此映射 HTTP 状态码 */
  readonly kind: WeKnoraErrorKind
  /** HTTP 状态码；网络错/超时时为 undefined */
  readonly status: number | undefined
  /** 触发的 WeKnora 接口路径（不含 base_url，不含任何密钥） */
  readonly path: string
  /** 是否值得重试（GET 幂等调用据此决定是否重试） */
  readonly retryable: boolean
  /** 响应体片段（截断后便于排障，不含密钥） */
  readonly responseSnippet: string
  override readonly cause: unknown

  constructor(init: WeKnoraErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'WeKnoraError'
    this.kind = init.kind
    this.status = init.status
    this.path = init.path
    this.retryable = init.retryable
    this.responseSnippet = init.responseSnippet ?? ''
    this.cause = init.cause
  }

  /** 把任意未知异常收敛成 WeKnoraError（供路由层兜底） */
  static from(err: unknown, path: string): WeKnoraError {
    if (err instanceof WeKnoraError) return err
    const message = err instanceof Error ? err.message : String(err)
    return new WeKnoraError({
      kind: 'network',
      message: `调用 WeKnora 失败（${path}）：${message}`,
      path,
      retryable: false,
      cause: err,
    })
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

/** HTTP 状态码 -> 错误分类 + 是否可重试 */
export function classifyStatus(status: number): { kind: WeKnoraErrorKind; retryable: boolean } {
  if (status === 401) return { kind: 'unauthorized', retryable: false }
  if (status === 403) return { kind: 'forbidden', retryable: false }
  if (status === 404) return { kind: 'not_found', retryable: false }
  if (status === 429) return { kind: 'rate_limited', retryable: true }
  if (status >= 500) return { kind: 'server_error', retryable: RETRYABLE_STATUS.has(status) }
  return { kind: 'client_error', retryable: false }
}

/** 分类 -> 默认中文文案 */
export function messageForKind(kind: WeKnoraErrorKind, status: number | undefined): string {
  const suffix = status === undefined ? '' : `（HTTP ${status}）`
  switch (kind) {
    case 'unauthorized':
      return `WeKnora 认证失败：API Key 无效或已过期${suffix}`
    case 'forbidden':
      return `WeKnora 拒绝访问：Key 无该资源权限${suffix}`
    case 'not_found':
      return `WeKnora 资源不存在${suffix}`
    case 'rate_limited':
      return `WeKnora 限流，请稍后重试${suffix}`
    case 'server_error':
      return `WeKnora 服务端异常${suffix}`
    case 'timeout':
      return `WeKnora 响应超时`
    case 'network':
      return `WeKnora 网络不可达（确认服务已启动）`
    case 'client_error':
      return `WeKnora 拒绝了该请求（参数问题）${suffix}`
    case 'parse_error':
      return `WeKnora 响应体不符合预期格式`
  }
}

/** 截断响应片段，避免日志里塞进整篇文档 */
export function snippet(text: string, max = 300): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
