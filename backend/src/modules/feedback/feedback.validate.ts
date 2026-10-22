import {
  FEEDBACK_DESCRIPTION_MAX,
  FEEDBACK_DESCRIPTION_MIN,
  FEEDBACK_PATH_MAX,
  isFeedbackCategory,
} from './feedback.types.js'
import type { FeedbackCreateInput, FeedbackStatus } from './feedback.types.js'

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

export function parseFeedbackCreate(body: unknown): ParseResult<FeedbackCreateInput> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: '请填写问题分类和具体描述' }
  }
  const category = readString(body, 'category')
  if (category === null || !isFeedbackCategory(category)) {
    return { ok: false, message: '请选择问题分类' }
  }
  const rawDescription = readString(body, 'description')
  if (rawDescription === null) {
    return { ok: false, message: '请填写具体问题' }
  }
  const description = rawDescription.trim()
  if (description.length < FEEDBACK_DESCRIPTION_MIN) {
    return { ok: false, message: '请把问题写具体一点（至少 2 个字）' }
  }
  if (description.length > FEEDBACK_DESCRIPTION_MAX) {
    return { ok: false, message: `问题描述最多 ${FEEDBACK_DESCRIPTION_MAX} 字` }
  }
  const rawPath = readString(body, 'pagePath')
  const pagePath = rawPath === null ? '' : rawPath.trim().slice(0, FEEDBACK_PATH_MAX)
  return { ok: true, value: { category, description, pagePath } }
}

export function parseFeedbackStatus(body: unknown): ParseResult<FeedbackStatus> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: '请给出要改成的状态' }
  }
  const status = readString(body, 'status')
  if (status !== 'open' && status !== 'done') {
    return { ok: false, message: '状态只能是未处理或已处理' }
  }
  return { ok: true, value: status }
}

function readString(body: object, key: string): string | null {
  const value: unknown = Reflect.get(body, key)
  return typeof value === 'string' ? value : null
}
