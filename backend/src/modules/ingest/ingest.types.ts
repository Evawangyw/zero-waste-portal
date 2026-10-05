// 契约（模块内）：批量导入的数据结构
// 铁律：全字段显式声明，禁 any 逃逸；所有字段 readonly（导入流程是单向写）。

/** 一条 Excel 行解析后的导入任务（尚未上传） */
export interface IngestRow {
  /** Excel 行号（1 基，含表头；用于报告定位「第几行」） */
  readonly excelRow: number
  /** 映射文件里指定的那一列（如「文件名」）；它是文件定位的唯一依据 */
  readonly fileName: string
  /** 解析出的 custom_metadata（键为 WeKnora 侧中文键，值一律为 string） */
  readonly metadata: Readonly<Record<string, string>>
  /** 多值字段拆出的数组视图（如 知识领域 -> ['垃圾分类','塑料']）；仅用于报告与校验 */
  readonly multiValues: Readonly<Record<string, readonly string[]>>
}

/** 单条导入结果 */
export type IngestOutcome = 'success' | 'skipped' | 'failed'

export interface IngestRowResult {
  readonly excelRow: number
  readonly fileName: string
  readonly outcome: IngestOutcome
  /** WeKnora 侧 knowledge id（成功时才有） */
  readonly knowledgeId: string
  /** 失败原因（失败时才有）；跳过时给「已存在」 */
  readonly reason: string
  /** 尝试次数（含首次） */
  readonly attempts: number
  /** 该行最终写入的 custom_metadata（报告留档，便于主控逐字段核对） */
  readonly metadata: Readonly<Record<string, string>>
}

/** 导入汇总 */
export interface IngestReport {
  readonly knowledgeBaseId: string
  readonly inputDir: string
  readonly excelFile: string
  readonly mappingFile: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly total: number
  readonly succeeded: number
  readonly skipped: number
  readonly failed: number
  readonly results: readonly IngestRowResult[]
}

/** 映射配置：Excel 列名 -> custom_metadata 键（任务卡：改配置不改代码） */
export interface IngestFieldMapping {
  /** Excel 表头里的原始列名（真数据列名有出入时只改这里） */
  readonly column: string
  /** 写入 WeKnora custom_metadata 的键（中文键，与书架口径一致） */
  readonly key: string
  /**
   * 是否为多值字段（单元格可能是「垃圾分类、塑料」）。
   * 多值字段会拆成数组，并在报告里留档数组视图。
   * ⚠️ WeKnora 的 custom_metadata 只接受标量（string/number/bool/null），
   * 实测传数组返回 500「must be a string, number, boolean, or null」，
   * 所以拆出的数组用 joinMultiValue（默认「、」）拼回字符串写入 —— 数组是**解析层**的事实。
   */
  readonly multiValue: boolean
}

/** inputs/mapping.json 的完整形状 */
export interface IngestMapping {
  /** Excel 表头所在行（1 基）。钉钉导出通常第 1 行就是表头。 */
  readonly headerRow: number
  /** Excel 工作表名；缺省用第一个工作表 */
  readonly sheet: string | null
  /** 文件名所在列（用于定位 inputs/files/ 下的真实文件） */
  readonly fileColumn: string
  /** 空值占位（任务卡：与书架口径一致，用「未标注」） */
  readonly emptyValue: string
  /** 多值字段写回 WeKnora 时使用的连接符 */
  readonly multiValueJoiner: string
  /** 字段映射表 */
  readonly fields: readonly IngestFieldMapping[]
}

/** CLI 参数解析结果 */
export interface IngestCliOptions {
  /** 目标知识库 ID */
  readonly knowledgeBaseId: string
  /** 输入目录（含 metadata.xlsx / mapping.json / files/） */
  readonly inputDir: string
  /** 报告落盘路径（相对 inputDir 或绝对路径） */
  readonly reportPath: string
  /** Excel 文件名（相对 inputDir） */
  readonly excelFileName: string
  /** 映射配置文件名（相对 inputDir） */
  readonly mappingFileName: string
  /** 文件子目录（相对 inputDir） */
  readonly filesSubDir: string
  /** 只读演练：不真上传，报告里全标 skipped/dry-run */
  readonly dryRun: boolean
  /** 失败重试次数（0 = 不重试） */
  readonly retries: number
}

/** 上传所需的最小依赖（便于单测注入假实现，不碰网络） */
export interface IngestUploader {
  /** 库里已存在的文件名集合（小写归一，用于幂等跳过） */
  listExistingFileNames(knowledgeBaseId: string): Promise<ReadonlySet<string>>
  /** 上传文件（multipart），返回 WeKnora knowledge id */
  uploadFile(params: UploadFileParams): Promise<string>
  /** 把 custom_metadata 写回该条 knowledge */
  writeMetadata(knowledgeId: string, metadata: Readonly<Record<string, string>>): Promise<void>
}

export interface UploadFileParams {
  readonly knowledgeBaseId: string
  readonly fileName: string
  readonly filePath: string
  /** 与 custom_metadata 同内容，随上传一次写入（WeKnora 的 multipart metadata 字段） */
  readonly metadata: Readonly<Record<string, string>>
}
