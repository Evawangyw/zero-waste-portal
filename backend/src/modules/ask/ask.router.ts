// 模块边界：ask
// 契约：
//   POST /api/ask {"query":"..."} -> 200 + text/event-stream
//     检索在本机完成：BM25 与向量召回按名次融合，再按权威性、地域、核心概念重排
//     抽出可引用原文后，才用百炼按这些原文生成回答；答不了则说明库内没有依据
//     句尾 [[n]]，末尾 @@sources@@ 给前端做来源卡片
//   GET  /api/chat/history?conversationId= -> 当前窗口的消息，以及这个用户自己的窗口列表
//   POST /api/chat/history {question, answer, thinking, conversationId?} -> 写入当前窗口
//   POST /api/chat/conversations -> 新开一个空窗口（当前窗口已经是空的则不重复创建）
//   DELETE /api/chat/history {conversationId} -> 清空这一窗的消息，其他窗口不动
// 实现：提问不再调用 WeKnora。对话窗口只按登录用户隔离。右下角挂件不走这条路由。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getAuthContext, requireAuth } from '../auth/index.js'
import type { AuthLocals, AuthRequest } from '../auth/index.js'
import { composeExtractiveAnswer } from './ask.extract.js'
import { collectGroundedAnswer, decideGrounding, streamBailianDeltas } from './ask.generate.js'
import { retrieve } from './ask.retrieve.js'
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

  const debug = req.query['debug'] === '1'
  let retrieved
  try {
    retrieved = await retrieve(body.query)
  } catch (err) {
    const message = err instanceof Error ? err.message : '检索失败'
    res.status(503).json({ type: 'error', content: message })
    return
  }

  const composed = composeExtractiveAnswer(body.query, retrieved.hits)
  const decision = decideGrounding(composed)

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  if (debug) {
    for (const hit of retrieved.hits) {
      writeSse(res, {
        type: 'raw',
        content: JSON.stringify({
          knowledge_id: hit.knowledgeId,
          knowledge_title: hit.title,
          score: hit.score,
          channel: hit.channel ?? 'lexical',
          content: hit.content.slice(0, 500),
        }),
        responseType: 'references',
      })
    }
  }
  if (body.includeThinking === true) {
    writeSse(res, {
      type: 'thinking',
      content: thinkingLine(retrieved, decision.action),
    })
  }
  if (decision.action === 'refuse') {
    writeSse(res, { type: 'answer', content: decision.notice })
    writeSse(res, { type: 'done', content: '' })
    res.end()
    return
  }

  const controller = new AbortController()
  const onClose = (): void => {
    if (!res.writableEnded) controller.abort()
  }
  res.on('close', onClose)
  try {
    const answer = await collectGroundedAnswer(
      streamBailianDeltas(body.query, decision.evidence, controller.signal),
      decision.sources,
    )
    writeSse(res, { type: 'answer', content: answer })
  } catch (err) {
    if (!controller.signal.aborted && !res.writableEnded) {
      const message = err instanceof Error ? err.message : '生成回答失败'
      console.error('[ask] 百炼生成失败', message)
      writeSse(res, { type: 'error', content: '生成回答失败，请再试一次' })
    }
  } finally {
    res.off('close', onClose)
  }
  if (!res.writableEnded) {
    writeSse(res, { type: 'done', content: '' })
    res.end()
  }
}

function thinkingLine(
  retrieved: { vectorReady: boolean; lexicalCount: number; vectorCount: number; hits: readonly unknown[] },
  action: 'generate' | 'refuse',
): string {
  const counts = retrieved.vectorReady
    ? `词法召回 ${retrieved.lexicalCount} 条，向量召回 ${retrieved.vectorCount} 条，融合后 ${retrieved.hits.length} 个片段。`
    : `向量索引还在构建，本次词法召回 ${retrieved.lexicalCount} 条。`
  return action === 'refuse' ? `${counts}没有可引用的原文，不调用模型。` : `${counts}只根据这些资料生成回答。`
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

