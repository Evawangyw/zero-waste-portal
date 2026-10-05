// 前端全局常量（PRD 口径的唯一出处，改文案只改这里）
import type { ShelfSort, TrackEventName } from './api/types'

/** localStorage 里放 JWT 的键名 */
export const TOKEN_STORAGE_KEY = 'zwp.auth.token'

/** sessionStorage 里放埋点会话标识的键名（T07）：刷新不变、换标签页即新会话 */
export const TRACK_SESSION_STORAGE_KEY = 'zwp.track.sid'

/** 本项目里的"资料书架"叫法 */
export const APP_NAME = '零废弃知识库'

/** 首页 3 个示例问题（PRD 两类场景：清单式 / 场景式 / 政策原文式） */
export interface SampleQuestion {
  /** 场景标签，前端分组展示 */
  readonly scene: string
  readonly text: string
}

export const SAMPLE_QUESTIONS: readonly SampleQuestion[] = [
  {
    scene: '清单式',
    text: '零废弃领域有哪些相关政策？',
  },
  {
    scene: '场景式',
    text: '社区厨余堆肥活动怎么设计？',
  },
  {
    scene: '政策原文式',
    text: '生活垃圾分类工作有哪些考核要求？',
  },
]

/** 书架每页条数（后端默认 20，这里显式传，保证分页条数与后端上限一致） */
export const SHELF_PAGE_SIZE = 20

/**
 * 7 类埋点事件的中文标签与展示顺序（T08lite）。
 * key 必须与后端 track.types.ts 的 TRACK_EVENTS 完全一致，顺序即表格行序（后端对象键序不保证）。
 */
export const TRACK_EVENT_LABELS: readonly {
  readonly key: TrackEventName
  readonly label: string
}[] = [
  { key: 'page_view', label: '页面浏览 page_view' },
  { key: 'search', label: '检索 search' },
  { key: 'preview', label: '预览 preview' },
  { key: 'download', label: '下载 download' },
  { key: 'ai_ask', label: 'AI 提问 ai_ask' },
  { key: 'register', label: '注册 register' },
  { key: 'feedback_submit', label: '反馈提交 feedback_submit' },
]

/** 管理统计页自动刷新间隔：5 分钟（T08lite 卡片口径，二选一里我选了自动刷新 + 手动按钮都给） */
export const ADMIN_STATS_REFRESH_MS = 5 * 60 * 1000

/** 书架默认排序（后端 year_desc） */
export const DEFAULT_SHELF_SORT: ShelfSort = 'year_desc'

/** 排序项的中文标签（后端只给 key，label 归前端） */
export const SHELF_SORT_OPTIONS: readonly { readonly value: ShelfSort; readonly label: string }[] =
  [
    { value: 'year_desc', label: '年份（新→旧）' },
    { value: 'year_asc', label: '年份（旧→新）' },
    { value: 'title_asc', label: '标题（A→Z）' },
    { value: 'updated_desc', label: '最近更新' },
  ]

/** 注册页「关注议题」可选项（PRD 议题清单；后端只存字符串数组，不做枚举校验） */
export const TOPIC_OPTIONS: readonly string[] = [
  '政策倡导',
  '社区实践',
  '教育培训',
  '垃圾分类',
  '减塑替代',
  '厨余处理',
  '绿色消费',
  '其他',
]

/** 未标注哨兵（后端归一后的空值） */
export const MISSING_LABEL = '未标注'
