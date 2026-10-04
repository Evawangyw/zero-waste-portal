// 契约（模块内）：embed 模块的业务错误（router 统一转成 EmbedErrorResponse）
import type { EmbedErrorKind } from './embed.types.js'

export interface EmbedErrorInit {
  readonly kind: EmbedErrorKind
  readonly status: number
  readonly message: string
  readonly cause?: unknown
}

export class EmbedError extends Error {
  readonly kind: EmbedErrorKind
  readonly status: number
  override readonly cause: unknown

  constructor(init: EmbedErrorInit) {
    super(init.message)
    this.name = 'EmbedError'
    this.kind = init.kind
    this.status = init.status
    this.cause = init.cause
  }

  static from(err: unknown, fallbackMessage: string): EmbedError {
    if (err instanceof EmbedError) return err
    if (err instanceof Error && err.name === 'AbortError') {
      return new EmbedError({
        kind: 'upstream_error',
        status: 504,
        message: 'WeKnora 凭证交换超时',
        cause: err,
      })
    }
    const detail = err instanceof Error ? err.message : String(err)
    return new EmbedError({
      kind: 'internal',
      status: 500,
      message: `${fallbackMessage}（详见服务端日志）`,
      cause: new Error(detail),
    })
  }
}
