// 契约（模块内）：SSE 解析器
// 主控实测格式：逐行 `event:xxx` + `data:{json}`，response_type 区分 thinking/正文，done:true 结束。
// 本文件把字节流解析成 AskEvent 序列，只认 SSE 标准分隔（空行）与 \n/\r\n/\r 三种换行。
import { WeKnoraError } from './errors.js'
import type { AskEvent } from './types.js'

/** 原始 SSE 行 -> { event, data }，非 SSE 行返回 null */
function parseFrame(frame: string): { event: string; data: string } | null {
  let event = ''
  const dataLines: string[] = []
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '' || line.startsWith(':')) continue // 空行/心跳注释
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (event === '' && dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

/** data:{json} -> AskEvent；JSON 不合法时不抛（流中途一条脏数据不该打断整段回答） */
function toAskEvent(event: string, data: string): AskEvent | null {
  if (data.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  const obj = isRecord(parsed) ? parsed : {}
  return {
    event,
    responseType: readString(obj, 'response_type'),
    content: readString(obj, 'content'),
    done: readBool(obj, 'done'),
    raw: obj,
  }
}

/**
 * ⚠️ 协议实测修正（2026-10-05，用掉第 2 次 query 取证）：
 * WeKnora 每个事件都可能带 done:true，它只表示"该消息片段完结"，**不是**整段流结束。
 * 实测首帧就是 {"response_type":"agent_query","done":true,"content":""} 的入队确认帧；
 * 若见 done 就断流，正文一个字都拿不到。真正的终止信号是 response_type=complete
 * （stop/error 同样终止）。依据：WeKnora 前端 useChatStreamHandler 只在 complete 分支收尾。
 */
export function isTerminalEvent(evt: AskEvent): boolean {
  return evt.responseType === 'complete' || evt.responseType === 'stop' || evt.responseType === 'error'
}

/**
 * 把 ReadableStream<Uint8Array> 解析为 AskEvent 异步迭代器。
 * 不因 done 提前返回（见上方 isTerminalEvent 注释）；maxEvents 只用于防御上游异常无限流。
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  path: string,
  maxEvents = 20_000,
): AsyncGenerator<AskEvent, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let emitted = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE 以空行分帧；\r\n 情况下空行是 "\r\n\r\n"，故正则同时吃 \r\n 与 \n
      let match: RegExpExecArray | null
      while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const parsedFrame = parseFrame(frame)
        if (parsedFrame === null) continue
        const evt = toAskEvent(parsedFrame.event, parsedFrame.data)
        if (evt === null) continue
        emitted += 1
        yield evt
        if (evt.done) return
        if (emitted >= maxEvents) return
      }
    }
    // 流结束但没有以空行收尾：把残余 buffer 也解一遍，避免丢最后一段
    const tail = parseFrame(buffer)
    if (tail !== null) {
      const evt = toAskEvent(tail.event, tail.data)
      if (evt !== null) yield evt
    }
  } catch (err) {
    if (err instanceof WeKnoraError) throw err
    throw new WeKnoraError({
      kind: 'network',
      message: '读取 WeKnora SSE 流失败（连接中断）',
      path,
      retryable: false,
      cause: err,
    })
  } finally {
    reader.releaseLock()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key]
  return typeof v === 'string' ? v : ''
}

function readBool(obj: Record<string, unknown>, key: string): boolean {
  return obj[key] === true
}
