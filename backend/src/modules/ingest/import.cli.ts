// 命令行入口：Excel 元数据 + 文件夹 -> WeKnora 知识库 批量导入
//
// 用法（在仓库根或 backend/ 下都行，路径按 cwd 解析）：
//   npx tsx backend/src/modules/ingest/import.cli.ts --kb <知识库ID> --input inputs
//   npx tsx backend/src/modules/ingest/import.cli.ts --kb <ID> --input inputs --dry-run
//
// ⚠️ 红线：--kb 必填，不给默认值。导入是不可逆写操作，
//   万一漏传就可能把 400 份资料灌进业务库「111」，所以宁可报错退出。
import { loadEnvFile, WeKnoraClient } from '../../weknora/index.js'
import { writeReport } from './ingest.report.js'
import { INGEST_RETRY_TIMES, runIngest, summarize } from './ingest.run.js'
import { createWeKnoraUploader } from './ingest.uploader.js'
import type { IngestCliOptions } from './ingest.types.js'

/** 缺省值显式标成 string，否则 TS 会把字面量推成 'inputs' 这类窄字面量类型，赋值时报错 */
const DEFAULTS: Readonly<{
  inputDir: string
  excelFileName: string
  mappingFileName: string
  filesSubDir: string
}> = {
  inputDir: 'inputs',
  excelFileName: 'metadata.xlsx',
  mappingFileName: 'mapping.json',
  filesSubDir: 'files',
}

export function parseArgs(argv: readonly string[]): IngestCliOptions {
  let knowledgeBaseId = ''
  let inputDir = DEFAULTS.inputDir
  let excelFileName = DEFAULTS.excelFileName
  let mappingFileName = DEFAULTS.mappingFileName
  let filesSubDir = DEFAULTS.filesSubDir
  let reportPath = ''
  let dryRun = false
  let noRetry = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) continue
    const take = (): string => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`参数 ${arg} 缺值`)
      }
      i += 1
      return value
    }
    switch (arg) {
      case '--kb':
      case '--kb-id':
        knowledgeBaseId = take()
        break
      case '--input':
        inputDir = take()
        break
      case '--excel':
        excelFileName = take()
        break
      case '--mapping':
        mappingFileName = take()
        break
      case '--files':
        filesSubDir = take()
        break
      case '--report':
        reportPath = take()
        break
      case '--dry-run':
        dryRun = true
        break
      case '--no-retry':
        noRetry = true
        break
      case '--help':
      case '-h':
        throw new Error(USAGE)
      default:
        throw new Error(`未知参数 ${arg}\n${USAGE}`)
    }
  }

  if (knowledgeBaseId === '') {
    throw new Error(`必须显式传 --kb <知识库ID>（导入是不可逆写操作，不给默认值）\n${USAGE}`)
  }
  if (reportPath === '') reportPath = `${inputDir}/import-report.json`

  return {
    knowledgeBaseId,
    inputDir,
    excelFileName,
    mappingFileName,
    filesSubDir,
    reportPath,
    dryRun,
    retries: noRetry ? 0 : INGEST_RETRY_TIMES,
  }
}

const USAGE = `用法：
  npx tsx backend/src/modules/ingest/import.cli.ts --kb <知识库ID> [--input inputs] [--report <路径>] [--dry-run] [--no-retry]

参数：
  --kb <id>       目标知识库 ID（必填，不给默认值）
  --input <dir>   输入目录（默认 ${DEFAULTS.inputDir}）
  --excel <name>  Excel 文件名（相对 --input，默认 ${DEFAULTS.excelFileName}）
  --mapping <n>   映射配置文件名（相对 --input，默认 ${DEFAULTS.mappingFileName}）
  --files <dir>   文件子目录（相对 --input，默认 ${DEFAULTS.filesSubDir}）
  --report <path> 报告输出路径（默认 <input>/import-report.json）
  --dry-run       只解析不上传
  --no-retry      失败不重试（默认重试 ${INGEST_RETRY_TIMES} 次）`

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  loadEnvFile()
  const uploader = createWeKnoraUploader(WeKnoraClient.fromEnv())

  console.log(
    `[ingest] 目标库=${opts.knowledgeBaseId} 输入=${opts.inputDir}` +
      `${opts.dryRun === true ? '（dry-run，不上传）' : ''}`,
  )

  const result = await runIngest({
    knowledgeBaseId: opts.knowledgeBaseId,
    inputDir: opts.inputDir,
    excelFileName: opts.excelFileName,
    mappingFileName: opts.mappingFileName,
    filesSubDir: opts.filesSubDir,
    uploader,
    dryRun: opts.dryRun,
    retries: opts.retries,
  })

  console.log(`[ingest] 实际表头：${result.headerLine.join(' | ')}`)
  console.log(`[ingest] ${summarize(result)}`)
  for (const e of result.parseErrors) {
    console.error(`[ingest] 解析失败 第 ${e.excelRow} 行：${e.reason}`)
  }
  for (const r of result.report.results) {
    const tag = r.outcome === 'success' ? 'OK  ' : r.outcome === 'skipped' ? 'SKIP' : 'FAIL'
    const tail = r.reason === '' ? '' : ` — ${r.reason}`
    console.log(`  [${tag}] 第 ${r.excelRow} 行 ${r.fileName}${tail}`)
    console.log(`         ${JSON.stringify(r.metadata)}`)
  }

  const { jsonPath, textPath } = await writeReport(opts.reportPath, result.report)
  console.log(`[ingest] 报告(JSON)：${jsonPath}`)
  console.log(`[ingest] 报告(MD)：${textPath}`)

  if (result.report.failed > 0 || result.parseErrors.length > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error('[ingest] 失败：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
