// 问题反馈。分类键与 backend/src/modules/feedback/feedback.types.ts 保持一致。
import { request } from './http'

export const FEEDBACK_CATEGORIES = [
  { key: 'content', label: '资料内容有误' },
  { key: 'answer', label: 'AI 回答不准确' },
  { key: 'page', label: '页面打不开或报错' },
  { key: 'search', label: '找不到想要的资料' },
  { key: 'account', label: '账号或登录问题' },
  { key: 'idea', label: '功能建议' },
  { key: 'other', label: '其他' },
] as const

export type FeedbackCategoryKey = (typeof FEEDBACK_CATEGORIES)[number]['key']

export interface FeedbackUser {
  readonly id: string
  readonly name: string
  readonly org: string
  readonly phone: string
}

export interface FeedbackItem {
  readonly id: string
  readonly category: string
  readonly categoryLabel: string
  readonly description: string
  readonly pagePath: string
  readonly status: 'open' | 'done'
  readonly createdAt: string
  readonly user: FeedbackUser | null
}

export interface FeedbackListResponse {
  readonly success: true
  readonly total: number
  readonly open: number
  readonly items: readonly FeedbackItem[]
}

export interface FeedbackCreateResponse {
  readonly success: true
  readonly id: string
}

export interface FeedbackUpdateResponse {
  readonly success: true
  readonly item: FeedbackItem
}

export function submitFeedback(
  body: { readonly category: FeedbackCategoryKey; readonly description: string; readonly pagePath: string },
  token: string | null,
): Promise<FeedbackCreateResponse> {
  return request<FeedbackCreateResponse>('/feedback', { method: 'POST', token, body })
}

export function fetchFeedbackList(
  token: string,
  status: 'open' | 'done' | 'all',
): Promise<FeedbackListResponse> {
  return request<FeedbackListResponse>('/admin/feedback', { token, query: { status } })
}

export function updateFeedbackStatus(
  token: string,
  id: string,
  status: 'open' | 'done',
): Promise<FeedbackUpdateResponse> {
  return request<FeedbackUpdateResponse>(`/admin/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    body: { status },
  })
}
