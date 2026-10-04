// 模块边界：docs（文件层 · T04）
// 契约：本文件是「详情 / 预览 / 下载」三条路由对外数据形状的唯一真相来源，
// 实现（docs.file.meta / name / service / router）都不得偏离。
//
// GET /api/docs/:id
//   -> 200 DocDetailResponse
//   数据源：索引优先（SQLite knowledge_index），缺失/字段不全时回源 WeKnora 补齐；
//   含 custom_metadata 解析后的 年份/机构/知识类型/知识领域 + 摘要（WeKnora description）。
//
// GET /api/docs/:id/preview
//   -> 200 + 二进制流（Content-Type 按文件类型；Content-Disposition: inline）  【可预览时】
//   -> 200 + PreviewEnvelope（unsupported:true 或 tooLarge:true，引导前端改走下载）  【不可预览时】
//   判据：非浏览器原生类型 -> unsupported；字节数 > PREVIEW_MAX_BYTES(20MB, env 可配) -> tooLarge。
//
// GET /api/docs/:id/download   （**必须登录**，用 T02 的 requireAuth 解 JWT）
//   -> 200 + 二进制流（Content-Disposition: attachment; filename*=UTF-8''<年份>-<机构>-<标题>.ext）
//   -> 401 未登录（由 auth 模块守卫给出）
//   -> 404 资料不存在
//   副作用：每次成功开流写一条 DownloadLog（userId + docId + 重命名后的文件名 + 时间）。
//
// 硬约束：预览/下载**流式透传** weknoraClient 返回的 ReadableStream，
// 绝不整读进内存（20MB PDF 也不整取）。

/** 未标注哨兵（与书架层 MISSING_LABEL 同值，前端可统一过滤） */
export const META_MISSING = '未标注'

/**
 * 预览体积阈值：20MB（任务卡 R08「>20MB 返回 tooLarge」）。
 * 默认值写死在此，可用环境变量 PREVIEW_MAX_BYTES 覆盖（测试与调参不必改代码）。
 */
export const PREVIEW_MAX_BYTES = 20 * 1024 * 1024

/** 浏览器可原生渲染的类型 -> Content-Type；不在表内一律 unsupported（任务卡 R08） */
export const PREVIEW_CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
}

/** 可预览的扩展名（PREVIEW_CONTENT_TYPES 的键，导出方便自测与前端文案） */
export const PREVIEWABLE_EXTENSIONS: readonly string[] = Object.keys(PREVIEW_CONTENT_TYPES)

/** 详情响应体 */
export interface DocDetailResponse {
  readonly success: true
  readonly doc: DocDetail
  /** 四个可筛维度的展示值（空值已归一为 META_MISSING，前端无需判空） */
  readonly metadata: DocParsedMetadataView
  /** 是否四个维度全部标注齐全（42 条实测只有 1 条为 true，故必须给这个标记） */
  readonly metadataComplete: boolean
  readonly preview: PreviewAvailability
  readonly download: DownloadAvailability
  /** 数据来源：index=只用了本地索引；weknora=索引没有回源；index+weknora=索引+回源合并 */
  readonly source: 'index' | 'weknora' | 'index+weknora'
  /** 回源是否成功（失败时详情仍返回 200，只是 summary 可能为空） */
  readonly upstreamAvailable: boolean
}

/** 单条资料的详情视图 */
export interface DocDetail {
  readonly id: string
  readonly title: string
  /** 清洗后的可读标题（去公文壳/文号/扩展名）；清洗不出时回落为 title */
  readonly readableTitle: string
  readonly fileName: string
  /** 归一化扩展名（小写无点，如 'pdf'；上游未给为 ''） */
  readonly fileType: string
  readonly fileSize: number
  /** 摘要：WeKnora description（任务卡 R08 明写要它） */
  readonly summary: string | null
  /** 摘要短句：WeKnora profile.gist（引擎额外产出，取不到为 null） */
  readonly gist: string | null
  readonly folderPath: string
  readonly parseStatus: string
  readonly enableStatus: string
  readonly tags: readonly string[]
  /** custom_metadata 原样透出（键为中文：年份/知识类型/知识领域/知识发布机构） */
  readonly customMetadata: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
}

/** 解析后的四维度（展示值；空 -> META_MISSING，topics 空 -> []） */
export interface DocParsedMetadataView {
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
}

/** 解析后的四维度（原始值；空 -> ''，给前端做二次判断/回显） */
export interface DocParsedMetadata {
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
}

/** 预览可用性（详情里带一份，前端不用先请求预览再判断） */
export interface PreviewAvailability {
  readonly streamable: boolean
  readonly tooLarge: boolean
  readonly unsupported: boolean
  readonly contentType: string
  readonly sizeBytes: number
  readonly maxBytes: number
  /** 不可预览时的中文原因（可预览为 null） */
  readonly reason: string | null
}

/** 下载可用性 */
export interface DownloadAvailability {
  readonly allowed: true
  /** 预计的重命名下载文件名（前端可提前展示"将下载为 xxx"） */
  readonly fileName: string
}

/** 预览决策（纯函数产物，可单测；service 依它决定走流还是走 JSON） */
export interface PreviewDecision extends PreviewAvailability {
  /** true = 应该开流透传；false = 回 PreviewEnvelope */
  readonly streamable: boolean
}

/** 预览不可用时的响应体（形状固定，前端一个分支处理） */
export interface PreviewEnvelope {
  readonly success: true
  readonly preview: PreviewDecision
  readonly id: string
  readonly title: string
  readonly fileType: string
  readonly fileSize: number
  readonly downloadUrl: string
}

/** 文件层错误码 */
export type DocFileErrorKind =
  'bad_request' | 'unauthorized' | 'not_found' | 'upstream_unavailable' | 'internal'

/** 文件层统一错误体 */
export interface DocFileErrorResponse {
  readonly success: false
  readonly error: {
    readonly kind: DocFileErrorKind
    readonly message: string
  }
}
