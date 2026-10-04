// 契约（模块内，对外经 index.ts 暴露）：WeKnoraClient —— 全项目唯一对接层
// 环境事实（主控 T01 卡已实测，直接采信）：
//  - base http://localhost:8080，认证头 X-API-Key: $WEKNORA_API_KEY
//  - 列表 GET /api/v1/knowledge-bases/:id/knowledge?page&page_size（支持 keyword/tag_ids/sort_by）
//    实测响应 { data, page, page_size, success, total }；keyword 搜不到 custom_metadata 值
//  - 会话 POST /api/v1/sessions {title} -> 201 { data:{ id } }
//  - 问答 POST /api/v1/knowledge-chat/:sessionId {query, knowledge_base_ids} -> SSE 流
//  - 元信息 GET /api/v1/knowledge/:id ; 预览 GET /api/v1/knowledge/:id/preview
//  - 下载 GET /api/v1/knowledge/:id/download ; 批量 POST .../knowledge/batch-download
import { DEFAULT_SSE_TIMEOUT_MS, loadWeKnoraConfig } from './config.js'
import { WeKnoraError } from './errors.js'
import { parseSseStream } from './sse.js'
import { requestJson, requestStream, requestText, type TransportOptions } from './transport.js'
import type {
  AskEvent,
  AskKnowledgeParams,
  BatchDownloadResult,
  ListKnowledgeParams,
  ListKnowledgeResult,
  WeKnoraBinary,
  WeKnoraConfig,
  WeKnoraKnowledge,
  WeKnoraSession,
} from './types.js'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export class WeKnoraClient {
  readonly config: WeKnoraConfig
  private readonly transport: TransportOptions

  constructor(config: WeKnoraConfig = loadWeKnoraConfig()) {
    this.config = config
    this.transport = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      retries: config.retries,
    }
  }

  /** 便捷工厂：默认从 backend/.env 读配置 */
  static fromEnv(): WeKnoraClient {
    return new WeKnoraClient(loadWeKnoraConfig())
  }

  /** 默认测试/业务知识库 ID */
  get defaultKnowledgeBaseId(): string {
    return this.config.knowledgeBaseId
  }

  // ---------------------------------------------------------------- 列表

  /** 方法 1：拉一页 knowledge（GET 幂等，自带 2 次重试） */
  async listKnowledge(params: ListKnowledgeParams = {}): Promise<ListKnowledgeResult> {
    const kbId = params.knowledgeBaseId ?? this.config.knowledgeBaseId
    const page = normalizePositiveInt(params.page, 1)
    const pageSize = Math.min(
      normalizePositiveInt(params.pageSize, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    )

    const { text } = await requestText(this.transport, {
      method: 'GET',
      path: `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/knowledge`,
      query: {
        page,
        page_size: pageSize,
        keyword: params.keyword,
        sort_by: params.sortBy,
        tag_ids:
          params.tagIds !== undefined && params.tagIds.length > 0
            ? params.tagIds.join(',')
            : undefined,
      },
    })

    const envelope = asRecord(parseJson(text, `/api/v1/knowledge-bases/${kbId}/knowledge`))
    const rawItems = Array.isArray(envelope['data']) ? (envelope['data'] as unknown[]) : []
    return {
      items: rawItems.map(toKnowledge),
      total: asInt(envelope['total'], rawItems.length),
      page: asInt(envelope['page'], page),
      pageSize: asInt(envelope['page_size'], pageSize),
      success: envelope['success'] !== false,
    }
  }

  /**
   * 方法 1b：分页遍历整个知识库（任务卡「listKnowledge 分页遍历」）。
   * 内部按 total 自动翻页，最多 maxPages 页防止上游分页异常导致死循环。
   */
  async listAllKnowledge(
    params: Omit<ListKnowledgeParams, 'page'> = {},
    maxPages = 200,
  ): Promise<readonly WeKnoraKnowledge[]> {
    const out: WeKnoraKnowledge[] = []
    let page = 1
    for (let i = 0; i < maxPages; i += 1) {
      const result = await this.listKnowledge({ ...params, page })
      out.push(...result.items)
      const fetched = page * result.pageSize
      if (result.items.length === 0) break
      if (result.total > 0 && out.length >= result.total) break
      if (result.total > 0 && fetched >= result.total) break
      if (result.items.length < result.pageSize) break
      page += 1
    }
    return out
  }

  /** 只要 total，用于对账与验收（不拉全量数据，省带宽） */
  async countKnowledge(knowledgeBaseId?: string): Promise<number> {
    const result = await this.listKnowledge({
      knowledgeBaseId,
      page: 1,
      pageSize: 1,
    })
    return result.total
  }

  // ---------------------------------------------------------------- 单条

  /** 方法 2：取单条 knowledge 元信息 */
  async getKnowledge(knowledgeId: string): Promise<WeKnoraKnowledge> {
    const path = `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}`
    const payload = await requestJson(this.transport, { method: 'GET', path })
    const envelope = asRecord(payload)
    // 上游统一包一层 data；缺失时视为裸对象
    const body = isRecord(envelope['data']) ? envelope['data'] : envelope
    return toKnowledge(body)
  }

  // ---------------------------------------------------------------- 二进制

  /** 方法 3：预览（内联渲染用，小文件整取） */
  async preview(knowledgeId: string, signal?: AbortSignal): Promise<WeKnoraBinary> {
    return this.fetchBinary(
      `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}/preview`,
      signal,
      true,
    )
  }

  /**
   * 方法 3b：预览（流式透传，**不**整读进内存）。
   * T04 预览路由专用：桌面浏览器要原生渲染 PDF，整取 arrayBuffer 会把
   * 20MB 文件整个搬进 Node 内存。这里只取 Content-* 头 + ReadableStream，
   * 由调用方 pipe 给浏览器。既有 preview() 行为不变（内联小图/预览卡片仍在用）。
   */
  async previewStream(knowledgeId: string, signal?: AbortSignal): Promise<WeKnoraBinary> {
    return this.fetchBinary(
      `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}/preview`,
      signal,
      // inline=false -> fetchBinary 只回 stream，不读字节；超时给足 120s 与下载一致
      false,
    )
  }

  /** 方法 4：下载（流式透传，不全量进内存） */
  async download(knowledgeId: string, signal?: AbortSignal): Promise<WeKnoraBinary> {
    return this.fetchBinary(
      `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}/download`,
      signal,
      false,
    )
  }

  /** 方法 7：批量下载（POST，返回任务/结果对象原样） */
  async batchDownload(
    knowledgeIds: readonly string[],
    knowledgeBaseId?: string,
  ): Promise<BatchDownloadResult> {
    const kbId = knowledgeBaseId ?? this.config.knowledgeBaseId
    const path = `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/batch-download`
    const payload = await requestJson(this.transport, {
      method: 'POST',
      path,
      body: { knowledge_ids: [...knowledgeIds] },
    })
    return { raw: asRecord(payload) }
  }

  // ---------------------------------------------------------------- 会话问答

  /** 方法 5：创建会话 */
  async createSession(title: string): Promise<WeKnoraSession> {
    const payload = await requestJson(this.transport, {
      method: 'POST',
      path: '/api/v1/sessions',
      body: { title },
    })
    const envelope = asRecord(payload)
    const body = isRecord(envelope['data']) ? envelope['data'] : envelope
    const id = readString(body, 'id')
    if (id === '') {
      throw new WeKnoraError({
        kind: 'parse_error',
        message: '创建 WeKnora 会话成功但未返回 session id',
        path: '/api/v1/sessions',
        retryable: false,
      })
    }
    return { id, title: readString(body, 'title'), raw: body }
  }

  /**
   * 方法 6：向指定知识库提问，返回 SSE 事件异步迭代器（调用方负责转成 HTTP 流）。
   * 超时策略：流式不走 15s 非流式超时，改用 timeoutMs 总时长上限（默认 180s）；
   * 外部 signal（如 HTTP 客户端断开）同样中止上游，避免 WeKnora 白跑一次模型。
   * 知识库缺省时用 .env 的 WEKNORA_KB_ID。
   */
  async askKnowledgeBase(
    params: AskKnowledgeParams,
  ): Promise<AsyncGenerator<AskEvent, void, void>> {
    const kbIds =
      params.knowledgeBaseIds.length > 0
        ? [...params.knowledgeBaseIds]
        : [this.config.knowledgeBaseId]
    const path = `/api/v1/knowledge-chat/${encodeURIComponent(params.sessionId)}`
    const controller = new AbortController()
    const timeoutMs = params.timeoutMs ?? DEFAULT_SSE_TIMEOUT_MS
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            controller.abort()
          }, timeoutMs)
        : null
    // 外部取消（客户端断开）与总时长上限共用同一个 controller，谁先触发都算中止
    const onExternalAbort = (): void => {
      controller.abort()
    }
    if (params.signal !== undefined) {
      if (params.signal.aborted) controller.abort()
      else params.signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const { response } = await requestStream(this.transport, {
        method: 'POST',
        path,
        body: { query: params.query, knowledge_base_ids: kbIds },
        signal: controller.signal,
      })
      const body = response.body
      if (body === null) {
        throw new WeKnoraError({
          kind: 'parse_error',
          message: 'WeKnora 问答接口未返回响应体',
          path,
          retryable: false,
        })
      }
      return this.withCleanup(parseSseStream(body, path), () => {
        if (timer !== null) clearTimeout(timer)
      })
    } catch (err) {
      if (timer !== null) clearTimeout(timer)
      throw WeKnoraError.from(err, path)
    }
  }

  // ---------------------------------------------------------------- 内部

  /** preview / download 共用：统一读 Content-* 头，超大文件只给 stream 不进内存 */
  private async fetchBinary(
    path: string,
    signal: AbortSignal | undefined,
    inline: boolean,
  ): Promise<WeKnoraBinary> {
    const { response } = await requestStream(this.transport, {
      method: 'GET',
      path,
      signal,
      // 下载给足 120s，避免大文件被 15s 砍断；preview 走默认
      timeoutMs: inline ? undefined : 120_000,
    })
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
    const contentDisposition = response.headers.get('content-disposition') ?? ''
    const contentLength = asInt(Number(response.headers.get('content-length')), 0)

    // 只有 preview（内联、体积小）才整取字节；download 保持流式由调用方 pipe
    if (!inline) {
      return {
        contentType,
        contentDisposition,
        contentLength,
        bytes: new Uint8Array(0),
        stream: response.body,
      }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { contentType, contentDisposition, contentLength, bytes, stream: null }
  }

  /** 给异步生成器挂 finally 清理钩子（清 SSE 总超时定时器） */
  private withCleanup(
    gen: AsyncGenerator<AskEvent, void, void>,
    cleanup: () => void,
  ): AsyncGenerator<AskEvent, void, void> {
    return (async function* wrapped(): AsyncGenerator<AskEvent, void, void> {
      try {
        for await (const evt of gen) yield evt
      } finally {
        cleanup()
      }
    })()
  }
}

// ------------------------------------------------------------------ 字段映射

/** 上游 snake_case -> 对接层 camelCase；未建模字段进 raw 透传 */
function toKnowledge(raw: unknown): WeKnoraKnowledge {
  const obj = asRecord(raw)
  return {
    id: readString(obj, 'id'),
    title: readString(obj, 'title'),
    description: readString(obj, 'description'),
    type: readString(obj, 'type'),
    fileName: readString(obj, 'file_name'),
    fileType: readString(obj, 'file_type'),
    fileSize: asInt(obj['file_size'], 0),
    parseStatus: readString(obj, 'parse_status'),
    enableStatus: readString(obj, 'enable_status'),
    folderPath: readString(obj, 'folder_path'),
    knowledgeBaseId: readString(obj, 'knowledge_base_id'),
    customMetadata: asRecord(obj['custom_metadata']),
    tags: toStringArray(obj['tags']),
    createdAt: readString(obj, 'created_at'),
    updatedAt: readString(obj, 'updated_at'),
    raw: obj,
  }
}

function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key]
  return typeof v === 'string' ? v : ''
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return fallback
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new WeKnoraError({
      kind: 'parse_error',
      message: 'WeKnora 响应不是合法 JSON',
      path,
      retryable: false,
      cause: err,
    })
  }
}
