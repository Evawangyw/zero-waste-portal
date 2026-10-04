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
// 本文件做三件事：
//   1. GET /api/embed/config 拿挂件公开配置（渠道 UUID / 挂件基址 / token 接口），不硬编码；
//   2. 注入 script（幂等：重复调用不会重复注入，也不会重建实例）；
//   3. 暴露 openWithQuery（零结果页「试试问 AI」预填）与 setContext（注入页面上下文）。
import { ref } from 'vue'
import { fetchEmbedConfig } from '../api/embed'
import type { EmbedWidgetPublicConfig } from '../api/types'

/** 挂件状态：供页面显示挂件是否就绪 / 是否失败 */
export type WidgetStatus = 'idle' | 'loading' | 'ready' | 'error'

const status = ref<WidgetStatus>('idle')
const config = ref<EmbedWidgetPublicConfig | null>(null)
const errorMessage = ref('')

let injectPromise: Promise<EmbedWidgetPublicConfig | null> | null = null
let scriptElement: HTMLScriptElement | null = null

/** 挂件是否已注入过（幂等判据） */
function alreadyInjected(): boolean {
  return scriptElement !== null && document.querySelector('script[data-zwp-widget]') !== null
}

/**
 * 挂载挂件。并发调用共享同一个 Promise（首页与书架页都会调）。
 * 失败不抛给页面 —— 挂件挂了不该让整页白屏，页面据此提示「AI 助手暂不可用，可改用搜索」。
 */
export function mountWidget(): Promise<EmbedWidgetPublicConfig | null> {
  if (injectPromise !== null) return injectPromise
  injectPromise = doMount()
  return injectPromise
}

async function doMount(): Promise<EmbedWidgetPublicConfig | null> {
  if (alreadyInjected()) {
    status.value = 'ready'
    return config.value
  }
  status.value = 'loading'
  try {
    const response = await fetchEmbedConfig()
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
      status.value = 'ready'
    })
    script.addEventListener('error', () => {
      status.value = 'error'
      errorMessage.value = 'AI 助手脚本加载失败（可先用书架搜索）'
    })

    document.body.appendChild(script)
    scriptElement = script
    return widget
  } catch (err) {
    status.value = 'error'
    errorMessage.value = err instanceof Error ? err.message : 'AI 助手初始化失败'
    return null
  }
}

/**
 * 打开挂件并自动发问（官方 openWithQuery）。
 * 脚本还没到货时先把问题记下来，脚本 load 后补发 —— 避免用户点了没反应。
 */
let pendingQuery: string | null = null

export function askWidget(question: string): void {
  const trimmed = question.trim()
  if (trimmed === '') return
  const api = window.WeKnora
  if (api === undefined) {
    pendingQuery = trimmed
    void mountWidget()
    return
  }
  api.openWithQuery(trimmed)
}

/** 脚本就绪后补发排队中的问题（App.vue 挂载后调一次即可） */
export function flushPendingQuery(): void {
  if (pendingQuery === null) return
  const api = window.WeKnora
  if (api === undefined) return
  const question = pendingQuery
  pendingQuery = null
  api.openWithQuery(question)
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
