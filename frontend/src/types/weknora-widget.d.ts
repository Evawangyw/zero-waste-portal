// 官方挂件 weknora-widget.js 的全局类型声明。
//
// 只声明**本项目真实用到**的编程式 API（openWithQuery / setContext / on('ready')），
// 不做完整 SDK 声明 —— 官方 SDK 全量类型在 WeKnora 仓库 frontend/public/weknora-widget.js。
export interface WeKnoraWidgetApi {
  /** 编程式初始化（静态 token / 安全模式二选一） */
  init(options: {
    channel?: string
    channelId?: string
    token?: string
    tokenEndpoint?: string
    position?: string
    primaryColor?: string
    title?: string
    baseUrl?: string
    width?: number | string
    height?: number | string
  }): unknown
  open(): void
  close(): void
  toggle(): void
  destroy(): void
  /** 上下文随每次提问注入（userId / page 等） */
  setContext(context: Record<string, unknown>): void
  /** 打开面板并自动发送提问（书架零结果页预填关键词用） */
  openWithQuery(query: string): void
  setLocale(locale: string): void
  on(event: 'ready' | string, handler: (payload?: unknown) => void): void
  off(event: 'ready' | string, handler: (payload?: unknown) => void): void
}

declare global {
  interface Window {
    WeKnora?: WeKnoraWidgetApi
  }
}

export {}
