// 模块边界：ingest（批量导入）—— 对外唯一出口
// 铁律：其它模块只允许从本文件 import 本模块能力；禁止绕过它去读 inputs/ 下的原始配置。
export { INGEST_RETRY_TIMES, runIngest, summarize } from './ingest.run.js'
export type { RunIngestOptions, RunIngestResult } from './ingest.run.js'
export { loadMapping, MappingConfigError } from './ingest.mapping.js'
export { parseWorkbook, splitMultiValue } from './ingest.excel.js'
export type { ExcelReadResult, RowParseError } from './ingest.excel.js'
export { renderReportText, writeReport } from './ingest.report.js'
export { createWeKnoraUploader, describeError, resolveContentType } from './ingest.uploader.js'
export type {
  IngestCliOptions,
  IngestFieldMapping,
  IngestMapping,
  IngestOutcome,
  IngestReport,
  IngestRow,
  IngestRowResult,
  IngestUploader,
  UploadFileParams,
} from './ingest.types.js'