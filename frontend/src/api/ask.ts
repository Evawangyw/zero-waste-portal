// 首页对话：流式提问走已有 POST /api/ask；历史按登录用户存在 /api/chat/history。
import { ApiError, request } from './http'
import type { ChatHistoryResponse, SaveChatTurnResponse } from './types'

export interface AskDelta {
  readonly type: 'answer' | 'done' | 'error'
  readonly content: string
}

export function fetchChatHistory(token: string): Promise<ChatHistoryResponse> {
  return request<ChatHistoryResponse>('/chat/history', { token })
}

export function saveChatTurn(
  token: string,
  question: string,
  answer: string,
): Promise<SaveChatTurnResponse> {
  return request<SaveChatTurnResponse>('/chat/history', {
    method: 'POST',
    token,
    body: { question, answer },
  })
}

/** 读取 SSE。每收到一段回答正文就回调，结束或出错时返回。 */
export async function streamAsk(
  token: string,
  query: string,
  onAnswer: (chunk: string) => void,
): Promise<void> {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
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
    if (type !== 'answer' && type !== 'done' && type !== 'error') return null
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
