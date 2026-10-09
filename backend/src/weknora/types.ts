// 契约（模块内）：WeKnora 对接层数据结构
// 环境事实来源：主控 T01 卡「主控已实测的环境事实」+ 本轮 1 次列表 GET 探测（未发问答，不耗模型额度）。
// 列表响应形状实测为 { data, page, page_size, success, total }。

/** 对接层错误分类 */
export type WeKnoraErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'client_error'
  | 'timeout'
  | 'network'
  | 'parse_error'

export interface WeKnoraErrorInit {
  readonly kind: WeKnoraErrorKind
  readonly message: string
  readonly path: string
  readonly retryable: boolean
  readonly status?: number | undefined
  readonly responseSnippet?: string | undefined
  readonly cause?: unknown
}

/** 单条 knowledge（只声明对接层与前端真正用到的字段，其余字段原样透传） */
export interface WeKnoraKnowledge {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly type: string
  readonly fileName: string
  readonly fileType: string
  readonly fileSize: number
  readonly parseStatus: string
  readonly enableStatus: string
  readonly folderPath: string
  readonly knowledgeBaseId: string
  /** 自定义元数据（键如 年份/知识类型/知识领域/知识发布机构）。主控实测：keyword 搜不到其值，列表也无按元数据筛选参数 */
  readonly customMetadata: Readonly<Record<string, unknown>>
  /** 标签数组（实测可能为 null） */
  readonly tags: readonly string[]
  /** WeKnora 侧创建/更新时间（ISO8601 带时区） */
  readonly createdAt: string
  readonly updatedAt: string
  /** 其余未建模字段透传，避免列表页丢信息 */
  readonly raw: Readonly<Record<string, unknown>>
}

/** 列表查询参数（主控实测：不支持按 custom_metadata 筛选/排序） */
export interface ListKnowledgeParams {
  readonly knowledgeBaseId?: string | undefined
  readonly page?: number | undefined
  readonly pageSize?: number | undefined
  readonly keyword?: string | undefined
  readonly sortBy?: string | undefined
  readonly tagIds?: readonly string[] | undefined
}

export interface ListKnowledgeResult {
  readonly items: readonly WeKnoraKnowledge[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly success: boolean
}

/** 上传文件入参（T09-lite 批量导入用） */
export interface UploadFileParams {
  /** 目标知识库 ID */
  readonly knowledgeBaseId: string
  /** 落库文件名（含扩展名，上传以此为准） */
  readonly fileName: string
  /** 文件原始字节（调用方读文件，传输层只管发） */
  readonly fileBytes: Uint8Array
  /** Content-Type；.pdf/.docx 等按扩展名推断 */
  readonly contentType: string
  /** 随上传一起写的 metadata（值必须为标量字符串，见 uploadFile 注释） */
  readonly metadata: Readonly<Record<string, string>>
  /** 可选标题（WeKnora 缺省拿文件名当 title） */
  readonly title?: string | undefined
  /** 上传超时覆盖（默认 120s） */
  readonly timeoutMs?: number | undefined
}

/** 上传结果（T09-lite） */
export interface UploadFileResult {
  readonly id: string
  /** 上游解析状态：pending/failed/done 等；解析失败不影响条目与元数据落库 */
  readonly parseStatus: string
  /** 上传时随 metadata 字段落下的内容（注意：不是 custom_metadata） */
  readonly metadata: Readonly<Record<string, unknown>>
}

/** 会话（POST /api/v1/sessions 返回 201） */
export interface WeKnoraSession {
  readonly id: string
  readonly title: string
  readonly raw: Readonly<Record<string, unknown>>
}

/** 二进制内容（preview / download 用），调用方自行决定落盘还是透传 */
export interface WeKnoraBinary {
  readonly contentType: string
  readonly contentDisposition: string
  readonly contentLength: number
  /** 原始字节；由调用方负责消费 */
  readonly bytes: Uint8Array
  /** 底层响应流（download 场景可直接 pipe，避免全量进内存） */
  readonly stream: ReadableStream<Uint8Array> | null
}

/** 问答 SSE 单事件（行格式 event:xxx + data:{json}） */
export interface AskEvent {
  /** 原始 event 名（主控实测有 thinking / 正文 等） */
  readonly event: string
  /** data 里的 response_type；未知时为 '' */
  readonly responseType: string
  /** data 里的正文/思考片段 */
  readonly content: string
  /** data.done === true 表示流结束 */
  readonly done: boolean
  /** data 原始对象（便于排查上游新增字段） */
  readonly raw: Readonly<Record<string, unknown>>
}

export interface AskKnowledgeParams {
  readonly sessionId: string
  readonly query: string
  readonly knowledgeBaseIds: readonly string[]
  /** 流式总时长上限；0/不传 = 不限（长回答兜底，默认 180s） */
  readonly timeoutMs?: number | undefined
  /** 外部取消信号（如 HTTP 客户端断开），与总时长上限任一触发即中止上游 */
  readonly signal?: AbortSignal | undefined
}

/**
 * POST /api/v1/knowledge-search 的一条命中。
 * 只建模抽取式回答用得到的字段；这是检索，不经过对话模型。
 */
export interface KnowledgeSearchHit {
  readonly id: string
  readonly content: string
  readonly knowledgeId: string
  readonly knowledgeTitle: string
  readonly knowledgeFilename: string
  readonly score: number
  /** 上游 knowledge_custom_metadata，实测为「键: 值」多行文本 */
  readonly customMetadataText: string
}

export interface BatchDownloadResult {
  readonly raw: Readonly<Record<string, unknown>>
}

/** 对接层配置（值全部来自 backend/.env，绝不硬编码） */
export interface WeKnoraConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly knowledgeBaseId: string
  /** 非流式请求默认超时 15s（任务卡要求） */
  readonly timeoutMs: number
  /** GET 幂等重试次数（任务卡：重试 2 次） */
  readonly retries: number
}
