// 官方挂件接入（T05）：按官方「方式二 · 安全模式」接 weknora-widget.js。
//
// 官方写法（website-docs/03-features/13-embed-channel.md）：
//   <script src="{base}/weknora-widget.js"
//           data-channel="渠道UUID"
//           data-token-endpoint="业务后端的换 token 接口"
//           data-position="bottom-right"></script>
// 安全模式里 publish token（em_）只留在业务后端，浏览器只拿 30 分钟短效 session token，
// loader 自己在约 80% TTL 处自动续期（weknora-widget.js 的 scheduleRefresh）。
//
// 本文件做四件事：
//   1. GET /api/embed/config 拿挂件公开配置（渠道 UUID / 挂件基址 / token 接口），不硬编码；
//   2. 注入 script（幂等：重复调用不会重复注入，也不会重建实例）；
//   3. 暴露 openWithQuery（零结果页「试试问 AI」预填）与 setContext（注入页面上下文）；
//   4. **串行发问队列**（QA-01 P0-2）：上一条还在生成时的新提问排队，绝不并发丢给挂件。
import { ref } from 'vue'
import { fetchEmbedConfig, fetchEmbedToken } from '../api/embed'
import { trackAiAsk } from './useTracking'
import { ApiError } from '../api/http'
import type { EmbedWidgetPublicConfig } from '../api/types'

/** 挂件状态：供页面显示挂件是否就绪 / 是否失败 */
export type WidgetStatus = 'idle' | 'loading' | 'ready' | 'error'

const status = ref<WidgetStatus>('idle')
const config = ref<EmbedWidgetPublicConfig | null>(null)
const errorMessage = ref('')

/** 排队中的提问条数（页面可据此把示例问题按钮置为「排队中」，让用户看见点了没丢） */
const queuedAskCount = ref(0)

let injectPromise: Promise<EmbedWidgetPublicConfig | null> | null = null
let scriptElement: HTMLScriptElement | null = null
/** 挂件事件是否已订阅过（loader 的 on() 是追加式，重复订阅会重复计数） */
let listenersBound = false
/** 登出拆掉挂件后递增，用来丢掉还在路上的注入 */
let mountGeneration = 0

/** 挂件是否已注入过（幂等判据） */
function alreadyInjected(): boolean {
  return scriptElement !== null && document.querySelector('script[data-zwp-widget]') !== null
}

/**
 * 挂载挂件。并发调用共享同一个 Promise（首页与书架页都会调）。
 * 失败不抛给页面 —— 挂件挂了不该让整页白屏，页面据此提示「AI 助手暂不可用，可改用搜索」。
 *
 * 成功注入后**会主动探一次 token**：QA-01 P1-4 里 token 换不到时首页照样显示
 * 「AI 助手已就绪」，用户点下去毫无反应。这里把「token 换得到」纳入就绪判据，
 * 换不到就置 error，让页面显示降级提示。
 */
export function mountWidget(): Promise<EmbedWidgetPublicConfig | null> {
  if (injectPromise !== null) return injectPromise
  const generation = mountGeneration
  injectPromise = doMount(generation).then((widget) => {
    if (generation !== mountGeneration) return null
    return widget
  })
  return injectPromise
}

/** 登出后拆掉右下角问答挂件。再次登录会重新注入。 */
export function dismissWidget(): void {
  mountGeneration += 1
  window.WeKnora?.close()
  window.WeKnora?.destroy()
  scriptElement?.remove()
  scriptElement = null
  injectPromise = null
  listenersBound = false
  status.value = 'idle'
  errorMessage.value = ''
  document.querySelectorAll('script[data-zwp-widget]').forEach((node) => {
    node.remove()
  })
}

async function doMount(generation: number): Promise<EmbedWidgetPublicConfig | null> {
  if (alreadyInjected()) {
    status.value = 'ready'
    return config.value
  }
  status.value = 'loading'
  try {
    const response = await fetchEmbedConfig()
    if (generation !== mountGeneration) return null
    const widget = response.widget
    config.value = widget

    const script = document.createElement('script')
    script.src = `${trimTrailingSlash(widget.baseUrl)}/weknora-widget.js`
    script.async = true
    // 官方 loader 靠 script 元素上的 data-* 属性自动初始化（document.currentScript）
    script.setAttribute('data-zwp-widget', '1')
    script.setAttribute('data-channel', widget.channelId)
    // 安全模式：只给换 token 的接口地址，publish token 永不到达浏览器
    script.setAttribute('data-token-endpoint', widget.tokenEndpoint)
    script.setAttribute('data-base-url', trimTrailingSlash(widget.baseUrl))
    script.setAttribute('data-position', widget.position)
    script.setAttribute('data-title', widget.title)
    script.addEventListener('load', () => {
      if (generation !== mountGeneration) {
        script.remove()
        return
      }
      bindWidgetListeners()
      void probeSessionToken()
      drainAskQueue()
    })
    script.addEventListener('error', () => {
      if (generation !== mountGeneration) return
      status.value = 'error'
      errorMessage.value = 'AI 助手脚本加载失败（可先用书架搜索）'
    })

    if (generation !== mountGeneration) return null
    document.body.appendChild(script)
    scriptElement = script
    return widget
  } catch (err) {
    if (generation !== mountGeneration) return null
    status.value = 'error'
    errorMessage.value = err instanceof Error ? err.message : 'AI 助手初始化失败'
    return null
  }
}

/**
 * 主动探一次 session token，把「凭证可用」纳入挂件就绪判据（P1-4）。
 * 注意这里换到的 token 不会被挂件复用（挂件自己会再换一次），只当探针用；
 * 探针失败只降级提示，不影响页面其余部分。
 */
async function probeSessionToken(): Promise<void> {
  try {
    await fetchEmbedToken()
    status.value = 'ready'
    errorMessage.value = ''
  } catch (err) {
    status.value = 'error'
    errorMessage.value =
      err instanceof ApiError ? err.message : 'AI 暂时不可用，请稍后再试（可先用书架搜索）'
  }
}

// ------------------------------------------------------------------ 发问队列（P0-2）

/**
 * QA-01 P0-2 复现结论与修法
 * ----------------------------
 * 现象：连点 3 个示例问题，只有 2 个气泡出现，中间那个被静默吞掉，但 ai_ask 照记 +3。
 * 触发面：官方 loader 的 openWithQuery 只是 `postMessage('open_with_query')`，
 * **它自己不排队**；而挂件 iframe（跨源，我们改不了）在「上一条还在生成」时
 * 收到新消息不会追加气泡 —— 问题被上游丢弃，我们这边却毫无察觉。
 * 所以问题不在"有没有点"，而在"并发发问"+"发问与埋点都以为成功了"。
 *
 * 修法（两条都在本文件内闭环，不碰跨源 iframe）：
 *   1. **串行**：同一时刻只允许一条 in-flight，其余进 askQueue 排队；
 *      收到 message_received（回答落地）才放下一条，并兜一个超时防死锁。
 *      => 用户点了必有且只有一个气泡，不再被上游丢。
 *   2. **埋点对齐**：ai_ask 改在 iframe 回 confirm 的 message_sent 上报 ——
 *      只有"挂件真的把它发出去了"才计数。上游丢掉的自然就不计数，
 *      顺带把"直接在挂件面板里打字"的提问也纳入了统计（原来完全没被记）。
 */
interface QueuedAsk {
  readonly question: string
  /** 站内入口（路由 path）；来自挂件面板手工输入的提问为 null */
  readonly source: string | null
}

const askQueue: QueuedAsk[] = []
let inFlight: QueuedAsk | null = null
let inFlightTimer: ReturnType<typeof setTimeout> | null = null

/** 单条回答的等待上限：超过就认为这条废了，放下一条（宁可多问也不卡死队列） */
const ASK_TIMEOUT_MS = 90_000

/** 订阅 loader 事件：message_sent 用来对齐埋点，message_received 用来放行队列 */
function bindWidgetListeners(): void {
  if (listenersBound) return
  const api = window.WeKnora
  if (api === undefined) return
  listenersBound = true
  api.on('message_sent', (payload) => {
    onMessageSent(payload)
  })
  api.on('message_received', () => {
    onMessageReceived()
  })
}

function onMessageSent(payload: unknown): void {
  const query = readEventQuery(payload)
  // 只有挂件确认"真的发出去了"才计数（原来在点击时无条件计数，上游吞掉的也照记）
  void trackAiAsk(query, resolveSource(query))
}

function onMessageReceived(): void {
  settleInFlight()
  drainAskQueue()
}

/** 这条提问算完了：清掉在途态并清计时器 */
function settleInFlight(): void {
  inFlight = null
  if (inFlightTimer !== null) {
    clearTimeout(inFlightTimer)
    inFlightTimer = null
  }
}

/**
 * 站内发问唯一入口（首页示例问题/自定义问题、书架零结果「试试问 AI」都走这里）。
 * 只入队，不直接调 openWithQuery —— 保证串行。
 */
export function askWidget(question: string): void {
  const trimmed = question.trim()
  if (trimmed === '') return
  askQueue.push({ question: trimmed, source: readPageSource() })
  queuedAskCount.value = askQueue.length + (inFlight === null ? 0 : 1)
  void mountWidget()
  drainAskQueue()
}

/** 放行队列：没有在途提问时取下一条发出去（脚本没到货就先攒着，load 后再放） */
function drainAskQueue(): void {
  if (inFlight !== null) return
  const api = window.WeKnora
  if (api === undefined) return
  const next = askQueue.shift()
  if (next === undefined) {
    queuedAskCount.value = 0
    return
  }
  inFlight = next
  queuedAskCount.value = askQueue.length + 1
  api.openWithQuery(next.question)
  inFlightTimer = setTimeout(() => {
    // 回答没回来（报错/上游卡死）：别让后面的提问永远排不上，放行
    inFlightTimer = null
    inFlight = null
    drainAskQueue()
  }, ASK_TIMEOUT_MS)
}

/** 埋点来源：命中站内队列就用队列里的来源，否则记为挂件面板手工输入 */
function resolveSource(question: string): string {
  if (inFlight !== null && inFlight.question === question) return inFlight.source ?? 'widget'
  return 'widget-panel'
}

/** loader 事件载荷里的问题文本（结构不对就退回空串，仍照常计数） */
function readEventQuery(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const raw = (payload as { readonly query?: unknown }).query
  return typeof raw === 'string' ? raw : ''
}

/** 埋点用的页面来源（书架零结果发问与首页发问要能分开看） */
function readPageSource(): string {
  return typeof window === 'undefined' ? 'unknown' : window.location.pathname
}

/**
 * 兼容旧调用点（App.vue / HomeView 在 mount 之后调一次）。
 * 队列已覆盖"脚本没到货"的场景，这里只保证脚本**此刻**可用时立刻放行。
 */
export function flushPendingQuery(): void {
  drainAskQueue()
}

/** 只打开右下角面板，不把问题发给模型。库内还没有正式资料时用。 */
export async function openWidget(): Promise<void> {
  await mountWidget()
  window.WeKnora?.open()
}

/** 注入页面上下文（随每次提问进模型，便于按场景区分回答） */
export function setWidgetContext(context: Record<string, unknown>): void {
  window.WeKnora?.setContext(context)
}

/** 挂件是否已可用（页面用来决定要不要显示提示） */
export function isWidgetReady(): boolean {
  return window.WeKnora !== undefined
}

/*
 * 状态以 ref 形式导出（不是包一层函数）：`<script setup>` 的模板会自动解包顶层 ref，
 * 包成函数的话模板里拿到的是函数本身，比较运算会报 TS2367。
 */
export { status as widgetStatus, config as widgetConfig, errorMessage as widgetError }
export { queuedAskCount as widgetQueuedAsks }

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
