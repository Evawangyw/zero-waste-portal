// 模块边界：ask
// 契约：
//   POST /api/ask {"query":"..."} -> 200 + text/event-stream（SSE 直通 WeKnora 的流）
//   GET  /api/chat/history?conversationId= -> 当前窗口的消息，以及这个用户自己的窗口列表
//   POST /api/chat/history {question, answer, thinking, conversationId?} -> 写入当前窗口
//   POST /api/chat/conversations -> 新开一个空窗口（当前窗口已经是空的则不重复创建）
//   DELETE /api/chat/history {conversationId} -> 清空这一窗的消息，其他窗口不动
// 实现：提问只经 weknora 对接层；WeKnora 会话 id 服务端持有，不外泄。对话窗口只按登录用户隔离。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getAuthContext, requireAuth } from '../auth/index.js'
import type { AuthLocals, AuthRequest } from '../auth/index.js'
import { WeKnoraClient, WeKnoraError, isTerminalEvent } from '../../weknora/index.js'
import type { AskEvent } from '../../weknora/index.js'
import {
  clearChatConversation,
  openChatWindow,
  saveChatTurn,
  startChatConversation,
  UnknownConversationError,
} from './ask.history.js'
import type { AskRequestBody, AskStreamEvent } from './ask.types.js'

/** 单次提问最大长度（防超长 query 打爆模型额度） */
const MAX_QUERY_LEN = 500

export const askRouter: Router = Router()

type AuthResponse = Response<unknown, AuthLocals>

askRouter.post('/api/ask', (req: Request, res: Response) => {
  void handleAsk(req, res)
})

askRouter.get('/api/chat/history', requireAuth, (req: AuthRequest, res: AuthResponse) => {
  void handleHistory(req, res)
})

askRouter.post('/api/chat/history', requireAuth, (req: AuthRequest, res: AuthResponse) => {
  void handleSaveTurn(req, res)
})

askRouter.post('/api/chat/conversations', requireAuth, (_req: AuthRequest, res: AuthResponse) => {
  void handleNewConversation(res)
})

askRouter.delete('/api/chat/history', requireAuth, (req: AuthRequest, res: AuthResponse) => {
  void handleClearConversation(req, res)
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
  // 客户端断开 -> 中止上游 WeKnora（signal 真正透传到 fetch，WeKnora 侧随之停止）
  const clientGone = new AbortController()
  let events: AsyncGenerator<AskEvent, void, void>
  try {
    const session = await client.createSession(`web:${body.query.slice(0, 30)}`)
    events = await client.askKnowledgeBase({
      sessionId: session.id,
      query: body.query,
      knowledgeBaseIds: body.knowledgeBaseIds ?? [],
      signal: clientGone.signal,
    })
  } catch (err) {
    const error = WeKnoraError.from(err, '/api/ask')
    res.status(statusFor(error.kind)).json({ type: 'error', content: error.message })
    return
  }

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

  let terminated = false
  const announcedTools = new Set<string>()
  try {
    for await (const evt of events) {
      if (clientGone.signal.aborted) break
      if (debug) {
        writeSse(res, {
          type: 'raw',
          content: JSON.stringify(evt.raw),
          responseType: evt.responseType,
        })
        if (isTerminalEvent(evt)) break
        continue
      }
      // 终止信号：complete / stop / error（不是 done！见 weknora/sse.ts 的协议实测注释）
      if (isTerminalEvent(evt)) {
        writeSse(res, {
          type: evt.responseType === 'error' ? 'error' : 'done',
          content: evt.content,
          responseType: evt.responseType,
        })
        terminated = true
        break
      }
      // 正文分片
      if (evt.responseType === 'answer') {
        if (evt.content !== '') writeSse(res, { type: 'answer', content: evt.content })
        continue
      }
      // 思考过程与工具调用：首页要展示。默认仍不透，includeThinking=true 才给。
      if (body.includeThinking === true) {
        const trace = readAgentTrace(evt, announcedTools)
        if (trace !== '') writeSse(res, { type: 'thinking', content: trace })
      }
      if (
        evt.responseType === 'thinking' ||
        evt.responseType === 'reflection' ||
        evt.responseType === 'tool_call' ||
        evt.responseType === 'tool_result'
      ) {
        continue
      }
      // 其余类型（agent_query 入队确认 / references 引用 / session_title 等）不透给前端
    }
    // 上游没发终止帧就断了（异常收尾）：补一个 done，前端才知道流结束
    if (!terminated && !res.writableEnded && !clientGone.signal.aborted) {
      writeSse(res, { type: 'done', content: '' })
    }
  } catch (err) {
    const error = WeKnoraError.from(err, '/api/ask')
    // 流已开始，只能以 SSE error 事件收尾，不能再改 HTTP 状态码
    writeSse(res, { type: 'error', content: error.message })
  } finally {
    res.end()
  }
}

/** 把思考片段和工具调用收成前端能直接拼上的文字。同一次工具调用只报一次。 */
function readAgentTrace(
  evt: {
    readonly responseType: string
    readonly content: string
    readonly raw: Readonly<Record<string, unknown>>
  },
  announcedTools: Set<string>,
): string {
  if (evt.responseType === 'thinking' || evt.responseType === 'reflection') return evt.content
  if (evt.responseType !== 'tool_call' && evt.responseType !== 'tool_result') return ''
  const data = asRecord(evt.raw['data'])
  const name = readString(data, 'tool_name')
  if (name === '' || name === 'final_answer') return ''
  const id = readString(data, 'tool_call_id') || name
  const key = `${evt.responseType}:${id}`
  if (announcedTools.has(key)) return ''
  if (evt.responseType === 'tool_result') {
    announcedTools.add(key)
    return `\n${toolLabel(name)}完成\n`
  }
  const query = readToolQuery(data?.['arguments'])
  if (query === '' && !hasArguments(data?.['arguments'])) return ''
  announcedTools.add(key)
  return query === '' ? `\n${toolLabel(name)}\n` : `\n${toolLabel(name)}：${query}\n`
}

function toolLabel(name: string): string {
  if (name === 'search_knowledge') return '检索知识库'
  if (name === 'read_document') return '阅读文档'
  if (name === 'list_documents') return '查看文档列表'
  return `调用${name}`
}

function readToolQuery(raw: unknown): string {
  const record = typeof raw === 'string' ? parseObject(raw) : asRecord(raw)
  if (record === null) return typeof raw === 'string' ? clipTrace(raw) : ''
  for (const key of ['query', 'question', 'keyword']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return clipTrace(value.trim())
  }
  return ''
}

function hasArguments(raw: unknown): boolean {
  const record = typeof raw === 'string' ? parseObject(raw) : asRecord(raw)
  return record !== null && Object.keys(record).length > 0
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function clipTrace(value: string): string {
  return value.length <= 180 ? value : `${value.slice(0, 180)}…`
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
    knowledgeBaseIds: Array.isArray(ids)
      ? ids.filter((v): v is string => typeof v === 'string')
      : undefined,
    includeThinking: obj['includeThinking'] === true,
  }
}

async function handleHistory(req: AuthRequest, res: AuthResponse): Promise<void> {
  const auth = getAuthContext(res)
  if (auth === null) {
    res.status(401).json({ success: false, error: { message: '请先登录后再查看对话' } })
    return
  }
  const conversationId = readOptionalId(req.query['conversationId'])
  try {
    const window = await openChatWindow(auth.userId, conversationId)
    res.status(200).json({ success: true, ...window })
  } catch (err) {
    writeConversationError(res, err)
  }
}

async function handleSaveTurn(req: AuthRequest, res: AuthResponse): Promise<void> {
  const auth = getAuthContext(res)
  if (auth === null) {
    res.status(401).json({ success: false, error: { message: '请先登录后再保存对话' } })
    return
  }
  const turn = parseTurn(req.body)
  if (turn === null) {
    res.status(400).json({ success: false, error: { message: '需要 question 和 answer 两个文本字段' } })
    return
  }
  try {
    const window = await saveChatTurn(
      auth.userId,
      turn.question,
      turn.answer,
      turn.thinking,
      turn.conversationId,
    )
    res.status(201).json({ success: true, ...window })
  } catch (err) {
    writeConversationError(res, err)
  }
}

async function handleNewConversation(res: AuthResponse): Promise<void> {
  const auth = getAuthContext(res)
  if (auth === null) {
    res.status(401).json({ success: false, error: { message: '请先登录后再新开对话' } })
    return
  }
  const window = await startChatConversation(auth.userId)
  res.status(201).json({ success: true, ...window })
}

async function handleClearConversation(req: AuthRequest, res: AuthResponse): Promise<void> {
  const auth = getAuthContext(res)
  if (auth === null) {
    res.status(401).json({ success: false, error: { message: '请先登录后再清空对话' } })
    return
  }
  const conversationId = readOptionalId(readBodyId(req.body))
  if (conversationId === undefined) {
    res.status(400).json({ success: false, error: { message: '需要 conversationId' } })
    return
  }
  try {
    const window = await clearChatConversation(auth.userId, conversationId)
    res.status(200).json({ success: true, ...window })
  } catch (err) {
    writeConversationError(res, err)
  }
}

function writeConversationError(res: AuthResponse, err: unknown): void {
  if (err instanceof UnknownConversationError) {
    res.status(404).json({ success: false, error: { message: err.message } })
    return
  }
  console.error('[ask] 对话窗口操作失败', err)
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: { message: '对话操作失败，请再试一次' } })
  }
}

function parseTurn(raw: unknown): {
  readonly question: string
  readonly answer: string
  readonly thinking: string
  readonly conversationId?: string
} | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const question = obj['question']
  const answer = obj['answer']
  const thinking = obj['thinking']
  if (typeof question !== 'string' || question.trim() === '') return null
  if (typeof answer !== 'string' || answer.trim() === '') return null
  const conversationId = readOptionalId(obj['conversationId'])
  return {
    question: question.trim(),
    answer: answer.trim(),
    thinking: typeof thinking === 'string' ? thinking.trim() : '',
    ...(conversationId === undefined ? {} : { conversationId }),
  }
}

function readBodyId(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  return (raw as Record<string, unknown>)['conversationId']
}

function readOptionalId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
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
