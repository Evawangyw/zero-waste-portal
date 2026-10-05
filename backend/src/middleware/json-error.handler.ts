// 模块边界：HTTP 错误信封（全局兜底）
// 契约：jsonErrorHandler —— Express 4 错误中间件，把「body 解析阶段的失败」统一转成
//      与站内其它接口完全一致的 JSON 信封，不再吐 Express 默认的 HTML 错误页。
//
// 为什么需要它（QA-01 P1-3）：
//   express.json() 是在**进路由之前**执行的。请求体畸形（`{oops`）时它直接抛
//   SyntaxError，此时还没进任何业务路由，业务层的 respondError 一律接不到，
//   Express 兜底吐出 400 + 一整页 HTML，并且把解析器报错原文（内部信息）交给客户端。
//   T07 早就为 /api/track 单独挂了 trackJsonErrorHandler 治这个病，但只治了那一处。
//   本文件把同一套信封提到全局：任何 /api/* 打进来都返回 JSON。
//
// 三条边界：
//  1. 只处理 body 解析类错误（SyntaxError / strict 模式非法原始值 / entity.too.large），
//     业务代码主动抛的错一律 next(err) 原样交还，绝不改变既有路由的报错行为。
//  2. 只处理 /api/* 路径；非 API 路径 next(err) 交还 Express 默认处理。
//  3. 对外只给固定文案，绝不回显 err.message（避免泄露解析器/内部堆栈细节）。
import type { ErrorRequestHandler } from 'express'

/** 与站内其它接口同构的错误信封（success:false + error.code/message/issues） */
interface ApiErrorEnvelope {
  readonly success: false
  readonly error: {
    readonly code: 'VALIDATION_FAILED' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL_ERROR'
    readonly message: string
    readonly issues: readonly never[]
  }
}

/** 超过 express.json({limit}) 时 body-parser 抛的错误标记 */
const ENTITY_TOO_LARGE = 'entity.too.large'

export const jsonErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // headersSent 之后不能再改状态码/响应体，只能交回默认处理
  if (res.headersSent) {
    next(err)
    return
  }
  // 只兜 /api/*；其余路径交还原处理，保证既有非 API 行为一个字节都不变
  if (!req.originalUrl.startsWith('/api/')) {
    next(err)
    return
  }

  if (isEntityTooLarge(err)) {
    respond(res, 413, 'PAYLOAD_TOO_LARGE', '请求体超过 1MB 上限，请分批发送')
    return
  }
  if (isBodyParseError(err)) {
    // 完整报错只进服务端日志，对外一律给固定文案（不泄露解析器细节）
    console.error(
      `[json-envelope] ${req.method} ${req.originalUrl} 请求体解析失败：${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    respond(res, 400, 'VALIDATION_FAILED', '请求体不是合法 JSON')
    return
  }

  // 不是 body 解析问题（业务抛的错、404 之后的兜底等）：原样交还
  next(err)
}

function isBodyParseError(err: unknown): boolean {
  return err instanceof Error && err.name === 'SyntaxError'
}

function isEntityTooLarge(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'type' in err && err.type === ENTITY_TOO_LARGE
}

function respond(
  res: Parameters<ErrorRequestHandler>[2],
  status: number,
  code: 'VALIDATION_FAILED' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL_ERROR',
  message: string,
): void {
  const body: ApiErrorEnvelope = { success: false, error: { code, message, issues: [] } }
  res.status(status).json(body)
}
