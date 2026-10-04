// 模块边界：ask
// 契约：POST /api/ask {"query":"..."} -> 200 + text/event-stream（SSE 直通 WeKnora 的流）
// 实现：只经 weknora 对接层；会话 id 服务端持有，不外泄。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { WeKnoraClient, WeKnoraError } from '../../weknora/index.js'
import type { AskEvent } from '../../weknora/index.js'
import type { AskRequestBody, AskStreamEvent } from './ask.types.js'

/** 单次提问最大长度（防超长 query 打爆模型额度） */
const MAX_QUERY_LEN = 500

export const askRouter: Router = Router()

askRouter.post('/api/ask', (req: Request, res: Response) => {
  void handleAsk(req, res)
})

async function handleAsk(req: Request, res: Response): Promise<void> {
  const body = parseAskBody(req.body)
  if (body === null) {
    res.status(400).json({ type: 'error', content: '请求体需为 {"query":"你的问题"}' })
    return
  }
  if (body.query.length > MAX_QUERY_LEN) {
    res.status(400).json({ type: 'error', content: `问题过长（上限 ${MAX_QUERY_LEN} 字）` })
    return
  }

  const client = WeKnoraClient.fromEnv()
  const debug = req.query['debug'] === '1'
  let events: AsyncGenerator<AskEvent, void, void>
  try {
    const session = await client.createSession(`web:${body.query.slice(0, 30)}`)
    events = await client.askKnowledgeBase({
      sessionId: session.id,
      query: body.query,
      knowledgeBaseIds: body.knowledgeBaseIds ?? [],
    })
  } catch (err) {
    const error = WeKnoraError.from(err, '/api/ask')
    res.status(statusFor(error.kind)).json({ type: 'error', content: error.message })
    return
  }

  // 客户端断开时中止上游（AbortController 由 fetch signal 传给 WeKnora）
  const clientGone = new AbortController()
  req.on('aborted', () => {
    clientGone.abort()
  })
  res.on('close', () => {
    clientGone.abort()
  })

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 防 nginx 缓冲（deploy/nginx.conf 后续对齐）
  res.flushHeaders()

  try {
    for await (const evt of events) {
      if (clientGone.signal.aborted) break
      if (debug) {
        writeSse(res, { type: 'raw', content: JSON.stringify(evt.raw), responseType: evt.responseType })
        if (evt.done) break
        continue
      }
      if (evt.done) {
        writeSse(res, { type: 'done', content: evt.content })
        break
      }
      // 默认只透正文；includeThinking=true 才把 thinking 也给前端
      if (evt.responseType === 'thinking' && body.includeThinking !== true) continue
      writeSse(res, {
        type: evt.responseType === 'thinking' ? 'thinking' : 'answer',
        content: evt.content,
        responseType: evt.responseType,
      })
    }
  } catch (err) {
    const error = WeKnoraError.from(err, '/api/ask')
    // 流已开始，只能以 SSE error 事件收尾，不能再改 HTTP 状态码
    writeSse(res, { type: 'error', content: error.message })
  } finally {
    res.end()
  }
}

/** 每条事件按 SSE 规范写成 `data: {json}\n\n`（curl -N 能实时看到） */
function writeSse(res: Response, event: AskStreamEvent): void {
  if (res.writableEnded) return
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

/** 请求体解析：非对象 / query 非字符串 / query 空串一律判 400 */
function parseAskBody(raw: unknown): AskRequestBody | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const query = obj['query']
  if (typeof query !== 'string' || query.trim() === '') return null
  const ids = obj['knowledgeBaseIds']
  return {
    query: query.trim(),
    knowledgeBaseIds: Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string') : undefined,
    includeThinking: obj['includeThinking'] === true,
  }
}

function statusFor(kind: WeKnoraError['kind']): number {
  switch (kind) {
    case 'unauthorized':
    case 'forbidden':
    case 'client_error':
    case 'parse_error':
      return 502
    case 'not_found':
      return 404
    case 'rate_limited':
      return 429
    case 'timeout':
      return 504
    case 'network':
    case 'server_error':
      return 503
  }
}
