// 模块边界：ask
// 契约：
//   POST /api/ask {"query":"..."} -> 200 + text/event-stream
//     检索走 WeKnora /api/v1/knowledge-search（向量 + 重排，不生成）
//     正文是抽出来的原文句子，句尾 [[n]]，末尾 @@sources@@ 给前端做来源卡片
//   GET  /api/chat/history?conversationId= -> 当前窗口的消息，以及这个用户自己的窗口列表
//   POST /api/chat/history {question, answer, thinking, conversationId?} -> 写入当前窗口
//   POST /api/chat/conversations -> 新开一个空窗口（当前窗口已经是空的则不重复创建）
//   DELETE /api/chat/history {conversationId} -> 清空这一窗的消息，其他窗口不动
// 实现：提问只经 weknora 对接层。对话窗口只按登录用户隔离。右下角挂件不走这条路由。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getAuthContext, requireAuth } from '../auth/index.js'
import type { AuthLocals, AuthRequest } from '../auth/index.js'
import { WeKnoraClient, WeKnoraError } from '../../weknora/index.js'
import { composeExtractiveAnswer } from './ask.extract.js'
import type { ExtractHit } from './ask.extract.js'
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
  let hits
  try {
    hits = await client.searchKnowledge(body.query, body.knowledgeBaseIds)
  } catch (err) {
    const error = WeKnoraError.from(err, '/api/ask')
    res.status(statusFor(error.kind)).json({ type: 'error', content: error.message })
    return
  }

  const composed = composeExtractiveAnswer(
    body.query,
    hits.map(
      (hit): ExtractHit => ({
        knowledgeId: hit.knowledgeId,
        title: hit.knowledgeTitle !== '' ? hit.knowledgeTitle : hit.knowledgeFilename,
        content: hit.content,
        score: hit.score,
        customMetadataText: hit.customMetadataText,
      }),
    ),
  )

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  if (debug) {
    for (const hit of hits) {
      writeSse(res, {
        type: 'raw',
        content: JSON.stringify({
          knowledge_id: hit.knowledgeId,
          knowledge_title: hit.knowledgeTitle,
          score: hit.score,
          content: hit.content.slice(0, 500),
        }),
        responseType: 'references',
      })
    }
  }
  if (body.includeThinking === true) {
    writeSse(res, {
      type: 'thinking',
      content: `检索知识库，命中 ${hits.length} 个片段，按原文抽取回答。`,
    })
  }
  writeSse(res, { type: 'answer', content: composed.answer })
  writeSse(res, { type: 'done', content: '' })
  res.end()
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
