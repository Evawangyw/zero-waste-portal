// 埋点语义层（T07）：把「谁在用、在找什么」翻译成 7 类事件，交给 api/track.ts 发出去。
//
// 页面/组件只调这里的函数，不直接碰 /api/track：
//  - 会话标识（sessionId）在这里统一生成与保管（sessionStorage，刷新不变、换标签页即新会话）
//  - 登录用户（userId）统一取，匿名时给 null
//  - 各事件的 payload 形状集中在这里，后端契约变了只改这一个文件
//
// 铁律：**埋点永远不能弄坏页面**。所有对外函数内部都走 emit()，
// 它把「组装输入」整段包进 try/catch —— 因为组装是同步代码，一旦抛错会顺着
// afterEach / 事件处理器冒泡成白屏（真踩过：window.crypto.randomUUID 脱离 this 调用
// 在 Chrome 里抛 TypeError: Illegal invocation，直接把路由启动打断）。
//
// 已知边界（已写入交付文档）：官方挂件 v0.8.2 没有回答回调，浏览器里**直接在挂件面板打字**的提问
// 拿不到 answer/sources，后端会把它记成"未判定"；站内发起的提问目前也只带问题文本。
// 要拿到回答证据做无答案判定，需要 P2 自建问答 UI（走我们自己的 /api/ask SSE）。
import { trackEvent } from '../api/track'
import { currentUser } from './useAuth'
import { TRACK_SESSION_STORAGE_KEY } from '../constants'
import type { TrackEventName } from '../api/types'
import type { PublicUser } from '../api/types'

/**
 * 取（或生成）本次会话标识。
 * 用 sessionStorage：刷新页面不变（同一会话），新开标签页即新会话（UV 才有意义）。
 * 隐私模式/禁用 storage 时退化成"每次一个新 id"——宁可 UV 略高，也不要崩页面。
 */
export function trackSessionId(): string {
  try {
    const stored = window.sessionStorage.getItem(TRACK_SESSION_STORAGE_KEY)
    if (stored !== null && stored !== '') return stored
    const created = createId()
    window.sessionStorage.setItem(TRACK_SESSION_STORAGE_KEY, created)
    return created
  } catch {
    return createId()
  }
}

/**
 * 生成会话标识。
 * 注意 `cryptoObj.randomUUID()` 必须**带着 cryptoObj 调**：
 * 写成 `const f = crypto.randomUUID; f()` 会丢掉 this，Chrome 直接抛
 * TypeError: Illegal invocation（真踩过，害得路由启动失败）。
 */
function createId(): string {
  const cryptoObj: Crypto | undefined = window.crypto
  if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 当前页面路径（埋点默认的"页面来源"） */
function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`
}

/**
 * 唯一出口：组装 + 发出去，整段兜异常。
 * 失败只留一行 warn —— 统计是旁路，绝不能影响用户操作。
 */
function emit(
  event: TrackEventName,
  payload: Readonly<Record<string, unknown>>,
  path: string = currentPath(),
): void {
  try {
    void trackEvent({
      event,
      path,
      // 登录用户；未登录给 null（匿名访客，后端 userId 列存 NULL）
      userId: currentUser.value?.id ?? null,
      sessionId: trackSessionId(),
      payload,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`[track] 埋点组装失败（已忽略）：${detail}`)
  }
}

/** 路由切换时上报 PV。query 变化不重复计（书架筛选/搜索只改 query） */
export function trackPageView(fullPath: string, routePath: string, fromPath: string): void {
  emit('page_view', { route: routePath, from: fromPath, referrer: readReferrer() }, fullPath)
}

/**
 * 书架检索提交。
 * zeroResult 由 /api/docs 的返回值给出（服务端自己的判据，不在前端猜）。
 */
export interface SearchTrackInput {
  readonly term: string
  readonly total: number
  readonly zeroResult: boolean
  readonly filters: Readonly<Record<string, readonly string[]>>
}

export function trackSearch(input: SearchTrackInput): void {
  if (input.term.trim() === '' && countFilters(input.filters) === 0) return
  emit('search', {
    term: input.term,
    total: input.total,
    zeroResult: input.zeroResult,
    filters: input.filters,
  })
}

/**
 * 站内发起的提问（首页示例问题/自定义问题、书架零结果「试试问 AI」的统一收口）。
 * answer/sources 目前拿不到（挂件无回调），故只报问题；后端把这条记为「未判定」。
 */
export function trackAiAsk(question: string, source: string): void {
  emit('ai_ask', { question, source, judged: false })
}

/** 在线预览开流成功后 */
export interface PreviewTrackInput {
  readonly docId: string
  readonly fileType: string
  readonly sizeBytes: number
  readonly title: string
}

export function trackPreview(input: PreviewTrackInput): void {
  emit('preview', {
    docId: input.docId,
    fileType: input.fileType,
    sizeBytes: input.sizeBytes,
    title: input.title,
  })
}

/**
 * 下载成功后（**双写**的第二写）。
 * 第一写是 T04 后端的 DownloadLog（权威口径，含绕过前端的直连调用）；
 * 这条 EventLog 只是行为流，让下载与 page_view/search 在同一张表里做漏斗分析。
 */
export interface DownloadTrackInput {
  readonly docId: string
  readonly fileName: string
  readonly title: string
}

export function trackDownload(input: DownloadTrackInput): void {
  emit('download', {
    docId: input.docId,
    fileName: input.fileName,
    title: input.title,
  })
}

/** 注册成功（不记密码、也不记手机号；只记维度与来源页） */
export function trackRegister(user: PublicUser, fromPath: string): void {
  emit(
    'register',
    {
      org: user.org,
      occupation: user.occupation,
      topics: user.topics,
    },
    fromPath,
  )
}

/** 反馈提交：P2 有反馈页时直接调（接口侧已支持，本卡不接页面） */
export function trackFeedback(payload: Readonly<Record<string, unknown>>): void {
  emit('feedback_submit', payload)
}

function countFilters(filters: Readonly<Record<string, readonly string[]>>): number {
  let total = 0
  for (const values of Object.values(filters)) total += values.length
  return total
}

function readReferrer(): string {
  return typeof document === 'undefined' ? '' : document.referrer.slice(0, 200)
}
