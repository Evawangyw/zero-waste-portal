// 模块边界：track（入参校验与归一化）
//
// 契约（对外经 index.ts 暴露）：parseTrackEnvelope / parseTrackItem
//
// 三种信封都收（任务卡「批量数组也收」）：
//   单条对象 | 裸数组 | { events: [...] }
// 校验是**逐条**的：合法条数写入、非法条数进 rejected（允许部分成功）；
// 只有信封本身不可用（不是对象/数组、空数组、超 100 条、全部条目非法）才整批 400。
import { judgeNoAnswer } from './track.answer.js'
import type { TrackEvent, TrackEventInput, TrackIssue, TrackIssueCode } from './track.types.js'
import {
  TRACK_EVENTS,
  TRACK_MAX_EVENTS_PER_REQUEST,
  TRACK_MAX_PATH_CHARS,
  TRACK_MAX_PAYLOAD_CHARS,
  TRACK_MAX_SESSION_ID_CHARS,
  TRACK_MAX_TERM_CHARS,
  TRACK_MAX_USER_ID_CHARS,
} from './track.types.js'

/** 白名单查找表（避免每次线性扫 7 个字符串） */
const EVENT_SET: ReadonlySet<string> = new Set<string>(TRACK_EVENTS)

export type EnvelopeParse =
  | { readonly ok: true; readonly items: readonly unknown[] }
  | { readonly ok: false; readonly issue: TrackIssue }

export type ItemParse =
  | { readonly ok: true; readonly value: TrackEventInput }
  | { readonly ok: false; readonly issue: TrackIssue }

/** 普通对象（排除 null / 数组 / 其它原始类型） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(index: number, code: TrackIssueCode, message: string): TrackIssue {
  return { index, code, message }
}

/** 解析请求信封：单条 / 裸数组 / { events: [...] } */
export function parseTrackEnvelope(body: unknown): EnvelopeParse {
  if (Array.isArray(body)) {
    return readBatch(body)
  }
  if (!isPlainObject(body)) {
    return {
      ok: false,
      issue: issue(0, 'INVALID_BODY', '请求体必须是事件对象、事件数组，或 { events: [...] }'),
    }
  }
  const wrapped: unknown = body['events']
  if (wrapped === undefined) return { ok: true, items: [body] }
  if (!Array.isArray(wrapped)) {
    return {
      ok: false,
      issue: issue(0, 'INVALID_BODY', 'events 字段必须是数组'),
    }
  }
  return readBatch(wrapped)
}

function readBatch(items: readonly unknown[]): EnvelopeParse {
  if (items.length === 0) {
    return { ok: false, issue: issue(0, 'EMPTY_BATCH', '批量事件不能是空数组') }
  }
  if (items.length > TRACK_MAX_EVENTS_PER_REQUEST) {
    return {
      ok: false,
      issue: issue(
        0,
        'TOO_MANY_EVENTS',
        `单次最多 ${TRACK_MAX_EVENTS_PER_REQUEST} 条，本次 ${items.length} 条`,
      ),
    }
  }
  return { ok: true, items }
}

/** 解析单条事件：事件名白名单 + 长度截断 + 派生列（term / noAnswer / zeroResult） */
export function parseTrackItem(raw: unknown, index: number): ItemParse {
  if (!isPlainObject(raw)) {
    return { ok: false, issue: issue(index, 'INVALID_ITEM', '事件必须是对象') }
  }

  const rawEvent: unknown = raw['event']
  if (typeof rawEvent !== 'string' || !EVENT_SET.has(rawEvent)) {
    return {
      ok: false,
      issue: issue(
        index,
        'UNKNOWN_EVENT',
        `事件名必须是 ${TRACK_EVENTS.join(' / ')} 之一，收到：${String(rawEvent)}`,
      ),
    }
  }
  const event: TrackEvent = rawEvent as TrackEvent

  const rawPayload: unknown = raw['payload']
  if (rawPayload !== undefined && !isPlainObject(rawPayload)) {
    return {
      ok: false,
      issue: issue(index, 'INVALID_ITEM', 'payload 必须是普通对象（不能是数组/字符串/null）'),
    }
  }
  const payload: Record<string, unknown> = isPlainObject(rawPayload) ? rawPayload : {}

  let serialized: string
  try {
    serialized = JSON.stringify(payload)
  } catch {
    // 只可能来自循环引用（express 的 JSON body 解析过了，这里是防御性兜底）
    return { ok: false, issue: issue(index, 'INVALID_ITEM', 'payload 无法序列化为 JSON') }
  }
  if (serialized.length > TRACK_MAX_PAYLOAD_CHARS) {
    return {
      ok: false,
      issue: issue(
        index,
        'PAYLOAD_TOO_LARGE',
        `payload 超过 ${TRACK_MAX_PAYLOAD_CHARS} 字符（本次 ${serialized.length}）`,
      ),
    }
  }

  return {
    ok: true,
    value: {
      event,
      userId: readTruncatedString(raw['userId'], TRACK_MAX_USER_ID_CHARS),
      sessionId: readTruncatedString(raw['sessionId'], TRACK_MAX_SESSION_ID_CHARS) ?? '',
      path: readTruncatedString(raw['path'], TRACK_MAX_PATH_CHARS) ?? '',
      payload: serialized,
      term:
        event === 'search'
          ? readTerm(payload['term'])
          : event === 'ai_ask'
            ? readTerm(payload['question'])
            : '',
      noAnswer: event === 'ai_ask' ? judgeNoAnswer(payload) : null,
      zeroResult: event === 'search' && payload['zeroResult'] === true,
    },
  }
}

/**
 * 字符串字段读取：非字符串按缺省处理（缺省语义由调用方给），
 * 超长截断而不是拒绝 —— 匿名访客不该因为会话串超长就丢数据。
 */
function readTruncatedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max)
}

/**
 * 检索词归一：去首尾空白 + 内部连续空白折叠为一个空格 + 小写 + 截断。
 * 小写化让 "垃圾分类" 与 " 垃圾分类 " 在 Top10 里是同一个词。
 */
function readTerm(value: unknown): string {
  const text = readTruncatedString(value, TRACK_MAX_TERM_CHARS * 4)
  if (text === null) return ''
  const collapsed = text.replace(/\s+/gu, ' ').toLowerCase()
  return collapsed.length <= TRACK_MAX_TERM_CHARS
    ? collapsed
    : collapsed.slice(0, TRACK_MAX_TERM_CHARS)
}
