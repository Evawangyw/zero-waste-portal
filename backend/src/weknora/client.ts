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
import { snippet, WeKnoraError } from './errors.js'
import { parseSseStream } from './sse.js'
import {
  requestFormJson,
  requestJson,
  requestStream,
  requestText,
  type TransportOptions,
} from './transport.js'
import type {
  AskEvent,
  AskKnowledgeParams,
  BatchDownloadResult,
  ListKnowledgeParams,
  ListKnowledgeResult,
  UploadFileParams,
  UploadFileResult,
  WeKnoraBinary,
  WeKnoraConfig,
  KnowledgeSearchHit,
  WeKnoraKnowledge,
  WeKnoraSession,
} from './types.js'

/** 检索含向量与重排，15s 默认超时偏紧，单独放宽 */
const SEARCH_TIMEOUT_MS = 45_000

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

  // ---------------------------------------------------------------- 写入（T09-lite）

  /**
   * 方法 8：上传单个文件（multipart/form-data）。
   * 环境事实（本机实测，非文档抄写）：
   *  - 路由 POST /api/v1/knowledge-bases/:kbId/knowledge/file
   *  - 文件字段名固定 `file`；同请求可带 `metadata`（JSON 串），落到 knowledge.metadata
   *  - metadata 的值必须是**标量字符串**：传数组/对象上游报
   *    "Invalid metadata format / cannot unmarshal array into Go value of type string"
   *  - 上传非幂等，故这里不自动重试（重试责任在调用方）
   *  - 文件内容非文本（如随手造的假 PDF）时 parse_status 会是 failed，
   *    但知识条目与 metadata 都已落库，不影响导入结果
   * @returns 新建 knowledge 的 id
   */
  async uploadFile(params: UploadFileParams): Promise<UploadFileResult> {
    const path = `/api/v1/knowledge-bases/${encodeURIComponent(params.knowledgeBaseId)}/knowledge/file`
    const form = new FormData()
    form.append('file', new Blob([params.fileBytes], { type: params.contentType }), params.fileName)
    // 空 metadata 不发这个字段，避免上游对空 JSON 串做无意义解析
    if (Object.keys(params.metadata).length > 0) {
      form.append('metadata', JSON.stringify(params.metadata))
    }
    if (params.title !== undefined) form.append('title', params.title)

    const payload = await requestFormJson(this.transport, {
      method: 'POST',
      path,
      form,
      // 20MB 级文件 + 上游落盘，给足 120s（默认 15s 会砍断大文件）
      timeoutMs: params.timeoutMs ?? 120_000,
    })
    const envelope = asRecord(payload)
    if (envelope['success'] === false) {
      throw new WeKnoraError({
        kind: 'client_error',
        message: `WeKnora 上传失败：${readString(asRecord(envelope['error']), 'message')}`,
        path,
        retryable: false,
        responseSnippet: snippet(JSON.stringify(envelope)),
      })
    }
    const body = isRecord(envelope['data']) ? envelope['data'] : envelope
    const id = readString(body, 'id')
    if (id === '') {
      throw new WeKnoraError({
        kind: 'parse_error',
        message: 'WeKnora 上传成功但未返回 knowledge id',
        path,
        retryable: false,
      })
    }
    return {
      id,
      parseStatus: readString(body, 'parse_status'),
      metadata: asRecord(body['metadata']),
    }
  }

  /**
   * 方法 9：更新单条 knowledge（PUT /api/v1/knowledge/:id）。
   *
   * ⚠️ 为什么上传后还要补这一次 PUT（本机实测，任务卡「文件+元数据一次写入」的落地细节）：
   *  multipart 的 `metadata` 字段落在 knowledge.**metadata**，
   *  而书架/详情读的是 knowledge.**custom_metadata** —— 两者不是一回事。
   *  实测传 `custom_metadata` 作为 multipart 字段一律被忽略（读回仍是 {}）。
   *  所以：上传时先带 metadata（让标题/描述等侧信息尽量完整），
   *  再用本次 PUT 把 custom_metadata 真正写进去。
   *
   * ⚠️ custom_metadata 的值只接受 string/number/boolean/null；
   *  传数组或嵌套对象上游返回 500
   *  「custom_metadata field "X" must be a string, number, boolean, or null」。
   *  故调用方必须先把多值字段 join 成字符串。
   */
  async updateKnowledgeMetadata(
    knowledgeId: string,
    customMetadata: Readonly<Record<string, string>>,
    title?: string,
  ): Promise<void> {
    const path = `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}`
    const payload = await requestJson(this.transport, {
      method: 'PUT',
      path,
      body: {
        custom_metadata: customMetadata,
        ...(title !== undefined ? { title } : {}),
      },
    })
    const envelope = asRecord(payload)
    if (envelope['success'] === false) {
      throw new WeKnoraError({
        kind: 'client_error',
        message: `WeKnora 写入 custom_metadata 失败：${readString(asRecord(envelope['error']), 'message')}`,
        path,
        retryable: false,
        responseSnippet: snippet(JSON.stringify(envelope)),
      })
    }
  }

  /** 方法 10：按文件名批量查库里已存在的文件名（小写归一，幂等判断用） */
  async listExistingFileNames(knowledgeBaseId: string): Promise<ReadonlySet<string>> {
    const items = await this.listAllKnowledge({ knowledgeBaseId })
    const out = new Set<string>()
    for (const item of items) {
      const name = item.fileName.trim()
      if (name !== '') out.add(name.toLowerCase())
    }
    return out
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

  // ---------------------------------------------------------------- 检索 / 会话问答

  /**
   * 只检索、不生成。POST /api/v1/knowledge-search。
   * 知识库缺省时用 .env 的 WEKNORA_KB_ID。
   */
  async searchKnowledge(
    query: string,
    knowledgeBaseIds?: readonly string[],
  ): Promise<readonly KnowledgeSearchHit[]> {
    const ids =
      knowledgeBaseIds !== undefined && knowledgeBaseIds.length > 0
        ? [...knowledgeBaseIds]
        : [this.config.knowledgeBaseId]
    const path = '/api/v1/knowledge-search'
    const payload = await requestJson(this.transport, {
      method: 'POST',
      path,
      body: { query, knowledge_base_ids: ids },
      timeoutMs: SEARCH_TIMEOUT_MS,
    })
    const envelope = asRecord(payload)
    const rows = envelope['data']
    if (!Array.isArray(rows)) {
      throw new WeKnoraError({
        kind: 'parse_error',
        message: 'WeKnora 检索接口未返回 data 数组',
        path,
        retryable: false,
      })
    }
    const hits: KnowledgeSearchHit[] = []
    for (const row of rows) {
      const hit = toSearchHit(row)
      if (hit.knowledgeId !== '' && hit.content.trim() !== '') hits.push(hit)
    }
    return hits
  }

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

function toSearchHit(raw: unknown): KnowledgeSearchHit {
  const obj = asRecord(raw)
  const score = obj['score']
  return {
    id: readString(obj, 'id'),
    content: readString(obj, 'content'),
    knowledgeId: readString(obj, 'knowledge_id'),
    knowledgeTitle: readString(obj, 'knowledge_title'),
    knowledgeFilename: readString(obj, 'knowledge_filename'),
    score: typeof score === 'number' && Number.isFinite(score) ? score : 0,
    customMetadataText: readString(obj, 'knowledge_custom_metadata'),
  }
}

function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    const name = readTagName(item)
    if (name !== '' && !names.includes(name)) names.push(name)
  }
  return names
}

/** WeKnora 列表里的标签有时是字符串，有时是 { id, name }。书架只需要名称。 */
function readTagName(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value !== 'object' || value === null || !('name' in value)) return ''
  return typeof value.name === 'string' ? value.name.trim() : ''
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
