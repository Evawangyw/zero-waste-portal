// 契约：POST /api/ask 的请求/响应体
// 验收：curl -N -X POST http://localhost:4000/api/ask -d '{"query":"你好"}' => 200 + SSE。
// 正文是抽取式原文，不是对话模型生成。句尾 [[n]] 对应回答末尾的来源。
export interface AskRequestBody {
  readonly query: string
  readonly knowledgeBaseIds?: readonly string[] | undefined
  /** 是否把 WeKnora 的思考过程也透出（默认只透正文） */
  readonly includeThinking?: boolean | undefined
}

/** 单条流式事件（NDJSON，字段名面向前端）；raw 仅用于 ?debug=1 取证上游原始帧 */
export interface AskStreamEvent {
  readonly type: 'answer' | 'thinking' | 'done' | 'error' | 'raw'
  readonly content: string
  readonly responseType?: string | undefined
}
