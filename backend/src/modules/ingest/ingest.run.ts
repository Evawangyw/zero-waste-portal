// 契约（模块内，对外经 index.ts 暴露）：runIngest() —— 批量导入主流程
//
// 流程（任务卡「产出要求」逐条对应）：
//  读 Excel -> 按映射生成 custom_metadata -> 逐份调 WeKnora 上传 -> 失败重试 2 次 -> 生成导入报告
//
// 幂等：先 listExistingFileNames 拿库里已有文件名集合，命中即跳过（报告标「已存在」）。
// 为什么不靠上传接口去重：上传接口非幂等（重试/重跑都会造重复条目）。
// 重试策略：单条失败重试 2 次（共 3 次尝试），指数退避；
// 重试前**重新查一次**已有文件名 —— 首次上传可能其实成功了只是回包丢了。
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { loadMapping } from './ingest.mapping.js'
import { parseWorkbook, type ExcelReadResult } from './ingest.excel.js'
import { describeError } from './ingest.uploader.js'
import type { IngestReport, IngestRow, IngestRowResult, IngestUploader } from './ingest.types.js'

/** 任务卡：失败重试 2 次 */
export const INGEST_RETRY_TIMES = 2

export interface RunIngestOptions {
  /** 目标知识库 ID（CLI 必填，不给默认值 —— 避免误传到业务库） */
  readonly knowledgeBaseId: string
  /** 输入目录（含 metadata.xlsx / mapping.json / files/） */
  readonly inputDir: string
  /** Excel 文件名（相对 inputDir） */
  readonly excelFileName: string
  /** 映射配置文件名（相对 inputDir） */
  readonly mappingFileName: string
  /** 待上传文件所在子目录（相对 inputDir） */
  readonly filesSubDir: string
  readonly uploader: IngestUploader
  /** 只读演练：不真上传，报告里全标 skipped/dry-run */
  readonly dryRun?: boolean | undefined
  /** 覆盖重试次数（0 = 不重试，单测用） */
  readonly retries?: number | undefined
}

export interface RunIngestResult {
  readonly report: IngestReport
  /** 解析阶段就失败的行（文件名空等），不在 results 里，单独给主控看 */
  readonly parseErrors: readonly { excelRow: number; reason: string }[]
  /** 实际读到的表头 */
  readonly headerLine: readonly string[]
}

/** CLI 打印用的一行摘要 */
export function summarize(result: RunIngestResult): string {
  const r = result.report
  return `合计 ${r.total} ｜ 成功 ${r.succeeded} ｜ 跳过 ${r.skipped} ｜ 失败 ${r.failed} ｜ 解析失败 ${result.parseErrors.length}`
}

export async function runIngest(options: RunIngestOptions): Promise<RunIngestResult> {
  const startedAt = new Date().toISOString()
  const inputDir = resolve(options.inputDir)
  const excelPath = isAbsolute(options.excelFileName)
    ? options.excelFileName
    : join(inputDir, options.excelFileName)
  const mappingPath = isAbsolute(options.mappingFileName)
    ? options.mappingFileName
    : join(inputDir, options.mappingFileName)
  const filesDir = join(inputDir, options.filesSubDir)

  // 1) 读映射配置（配置错就直接抛，不带病跑）
  const mapping = loadMapping(mappingPath)

  // 2) 读 Excel 并按映射生成 custom_metadata
  const buffer = await readFile(excelPath)
  const parsed: ExcelReadResult = parseWorkbook(
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),
    mapping,
  )

  const existing = options.dryRun === true
    ? new Set<string>()
    : await options.uploader.listExistingFileNames(options.knowledgeBaseId)

  const retries = options.retries ?? INGEST_RETRY_TIMES
  const results: IngestRowResult[] = []
  for (const row of parsed.rows) {
    results.push(await importOne(row, options, filesDir, existing, retries))
  }

  const finishedAt = new Date().toISOString()
  const report: IngestReport = {
    knowledgeBaseId: options.knowledgeBaseId,
    inputDir,
    excelFile: excelPath,
    mappingFile: mappingPath,
    startedAt,
    finishedAt,
    total: parsed.rows.length,
    succeeded: results.filter((r) => r.outcome === 'success').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    results,
  }
  return { report, parseErrors: parsed.errors, headerLine: parsed.headerLine }
}

/** 单行导入：幂等判断 -> 上传 -> 写 custom_metadata；带重试 */
async function importOne(
  row: IngestRow,
  options: RunIngestOptions,
  filesDir: string,
  existing: Set<string>,
  retries: number,
): Promise<IngestRowResult> {
  const key = row.fileName.trim().toLowerCase()

  if (existing.has(key)) {
    return skipped(row, '已存在')
  }
  if (options.dryRun === true) {
    return {
      excelRow: row.excelRow,
      fileName: row.fileName,
      outcome: 'skipped',
      knowledgeId: '',
      reason: 'dry-run（未实际上传）',
      attempts: 0,
      metadata: row.metadata,
    }
  }

  const filePath = join(filesDir, row.fileName)
  let lastReason = ''
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const knowledgeId = await options.uploader.uploadFile({
        knowledgeBaseId: options.knowledgeBaseId,
        fileName: row.fileName,
        filePath,
        metadata: row.metadata,
      })
      // 上传只把 metadata 落到 knowledge.metadata；custom_metadata 要补一次 PUT
      await options.uploader.writeMetadata(knowledgeId, row.metadata)
      existing.add(key)
      return {
        excelRow: row.excelRow,
        fileName: row.fileName,
        outcome: 'success',
        knowledgeId,
        reason: '',
        attempts: attempt,
        metadata: row.metadata,
      }
    } catch (err) {
      lastReason = describeError(err)
      // 上传可能实际成功了（只是回包/网络丢了）：重试前先确认，避免造重复条目
      if (attempt <= retries) {
        const fresh = await safeListExisting(options.uploader, options.knowledgeBaseId)
        if (fresh !== null && fresh.has(key)) {
          existing.add(key)
          return {
            excelRow: row.excelRow,
            fileName: row.fileName,
            outcome: 'success',
            knowledgeId: '',
            reason: `第 ${attempt} 次尝试后回包异常，但复查发现已入库（幂等命中）`,
            attempts: attempt,
            metadata: row.metadata,
          }
        }
        await sleep(retryDelay(attempt))
      }
    }
  }

  return {
    excelRow: row.excelRow,
    fileName: row.fileName,
    outcome: 'failed',
    knowledgeId: '',
    reason: lastReason === '' ? '未知失败' : lastReason,
    attempts: retries + 1,
    metadata: row.metadata,
  }
}

function skipped(row: IngestRow, reason: string): IngestRowResult {
  return {
    excelRow: row.excelRow,
    fileName: row.fileName,
    outcome: 'skipped',
    knowledgeId: '',
    reason,
    attempts: 0,
    metadata: row.metadata,
  }
}

/** 复查已有文件名失败不应掩盖原始错误（吞掉返回 null，让上层继续按原计划重试） */
async function safeListExisting(
  uploader: IngestUploader,
  knowledgeBaseId: string,
): Promise<ReadonlySet<string> | null> {
  try {
    return await uploader.listExistingFileNames(knowledgeBaseId)
  } catch {
    return null
  }
}

const RETRY_BASE_DELAY_MS = 500

function retryDelay(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}