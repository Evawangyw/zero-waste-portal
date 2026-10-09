// 首页对话：流式提问走已有 POST /api/ask；历史按登录用户存在 /api/chat/history。
import { ApiError, request } from './http'
import type { ChatHistoryResponse, SaveChatTurnResponse } from './types'

export interface AskDelta {
  readonly type: 'answer' | 'thinking' | 'done' | 'error'
  readonly content: string
}

/** 与后端 EXTRACT_SOURCE_MARK 一致。回答正文在标记之前，来源 JSON 在标记之后。 */
const EXTRACT_SOURCE_MARK = '@@sources@@'

export interface AskSource {
  readonly index: number
  readonly docId: string
  readonly title: string
  readonly organization: string
  readonly year: string
  readonly docType: string
}

export function readExtractiveAnswer(content: string): {
  readonly body: string
  readonly sources: readonly AskSource[]
} {
  const at = content.indexOf(EXTRACT_SOURCE_MARK)
  if (at < 0) return { body: content, sources: [] }
  const body = content
    .slice(0, at)
    .replace(/\n*参考来源[\s\S]*$/, '')
    .trimEnd()
  return { body, sources: parseSources(content.slice(at + EXTRACT_SOURCE_MARK.length).trim()) }
}

function parseSources(raw: string): readonly AskSource[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const sources: AskSource[] = []
    for (const item of parsed) {
      const source = readSource(item)
      if (source !== null) sources.push(source)
    }
    return sources
  } catch {
    return []
  }
}

function readSource(value: unknown): AskSource | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as {
    readonly index?: unknown
    readonly docId?: unknown
    readonly title?: unknown
    readonly organization?: unknown
    readonly year?: unknown
    readonly docType?: unknown
  }
  if (typeof record.index !== 'number' || typeof record.docId !== 'string') return null
  if (typeof record.title !== 'string' || record.title === '') return null
  return {
    index: record.index,
    docId: record.docId,
    title: record.title,
    organization: typeof record.organization === 'string' ? record.organization : '',
    year: typeof record.year === 'string' ? record.year : '',
    docType: typeof record.docType === 'string' ? record.docType : '',
  }
}

export function fetchChatHistory(
  token: string,
  conversationId?: string,
): Promise<ChatHistoryResponse> {
  return request<ChatHistoryResponse>('/chat/history', {
    token,
    query: { conversationId },
  })
}

export function saveChatTurn(
  token: string,
  question: string,
  answer: string,
  thinking: string,
  conversationId?: string,
): Promise<SaveChatTurnResponse> {
  return request<SaveChatTurnResponse>('/chat/history', {
    method: 'POST',
    token,
    body: { question, answer, thinking, conversationId },
  })
}

export function startChatConversation(token: string): Promise<ChatHistoryResponse> {
  return request<ChatHistoryResponse>('/chat/conversations', { method: 'POST', token })
}

export function clearChatConversation(
  token: string,
  conversationId: string,
): Promise<ChatHistoryResponse> {
  return request<ChatHistoryResponse>('/chat/history', {
    method: 'DELETE',
    token,
    body: { conversationId },
  })
}

/** 读取 SSE。回答正文和思考过程分开回调。 */
export async function streamAsk(
  token: string,
  query: string,
  onAnswer: (chunk: string) => void,
  onThinking: (chunk: string) => void,
): Promise<void> {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, includeThinking: true }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new ApiError(response.status, readErrorContent(text, response.status))
  }
  if (response.body === null) {
    throw new ApiError(response.status, '回答流没有内容')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const step = await reader.read()
    if (step.done) return
    buffer += decoder.decode(step.value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = parseFrame(frame)
      if (event === null) continue
      if (event.type === 'answer' && event.content !== '') onAnswer(event.content)
      if (event.type === 'thinking' && event.content !== '') onThinking(event.content)
      if (event.type === 'error') throw new ApiError(502, event.content || '回答失败')
    }
  }
}

function parseFrame(frame: string): AskDelta | null {
  const line = frame
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.startsWith('data:'))
  if (line === undefined) return null
  const raw = line.slice('data:'.length).trim()
  if (raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as { readonly type?: unknown; readonly content?: unknown }
    const type = record.type
    if (type !== 'answer' && type !== 'thinking' && type !== 'done' && type !== 'error') return null
    return { type, content: typeof record.content === 'string' ? record.content : '' }
  } catch {
    return null
  }
}

function readErrorContent(text: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null) {
      const content = (parsed as { readonly content?: unknown }).content
      if (typeof content === 'string' && content !== '') return content
    }
  } catch {
    // 不是 JSON 就用状态码
  }
  return `提问失败（HTTP ${status}）`
}
