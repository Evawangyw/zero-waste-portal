// 契约：问题反馈
//
//   POST  /api/feedback
//     200 { success:true, id }
//     400 { success:false, error:{ message } }
//     登录可选。带了 Bearer 且有效时记下 userId；没带则匿名。无效 token 由登录守卫回 401。
//
//   GET   /api/admin/feedback?status=open|done|all
//     200 { success:true, total, open, items: FeedbackItem[] }
//     管理员（静态口令或 isAdmin JWT）
//
//   PATCH /api/admin/feedback/:id   { status:'open'|'done' }
//     200 { success:true, item }
//     404 找不到这条反馈

/** 分类键与展示名。前端选项必须与这里一致。 */
export const FEEDBACK_CATEGORIES = [
  { key: 'content', label: '资料内容有误' },
  { key: 'answer', label: 'AI 回答不准确' },
  { key: 'page', label: '页面打不开或报错' },
  { key: 'search', label: '找不到想要的资料' },
  { key: 'account', label: '账号或登录问题' },
  { key: 'idea', label: '功能建议' },
  { key: 'other', label: '其他' },
] as const

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]['key']

export type FeedbackStatus = 'open' | 'done'

export type FeedbackStatusFilter = FeedbackStatus | 'all'

export const FEEDBACK_DESCRIPTION_MIN = 2
export const FEEDBACK_DESCRIPTION_MAX = 2000
export const FEEDBACK_PATH_MAX = 300

export interface FeedbackCreateInput {
  readonly category: FeedbackCategory
  readonly description: string
  readonly pagePath: string
}

export interface FeedbackUserView {
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
  readonly status: FeedbackStatus
  readonly createdAt: string
  readonly user: FeedbackUserView | null
}

export interface FeedbackList {
  readonly total: number
  readonly open: number
  readonly items: readonly FeedbackItem[]
}

export function feedbackCategoryLabel(key: string): string {
  const found = FEEDBACK_CATEGORIES.find((item) => item.key === key)
  return found === undefined ? key : found.label
}

export function isFeedbackCategory(value: string): value is FeedbackCategory {
  return FEEDBACK_CATEGORIES.some((item) => item.key === value)
}
