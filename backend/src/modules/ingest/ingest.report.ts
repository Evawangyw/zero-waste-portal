// 契约（模块内）：导入报告生成与落盘
// 报告口径（任务卡）：成功/失败/跳过三张清单 + 失败原因 + 每行最终写入的 custom_metadata。
// 报告同时给人看（Markdown 段落）与给机器看（JSON），两者同源，避免两份口径打架。
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { IngestReport, IngestRowResult } from './ingest.types.js'

/** 报告里刻意不打真实文件字节/密钥，只打文件名与元数据 */
export function renderReportText(report: IngestReport): string {
  const lines: string[] = []
  lines.push('# 批量导入报告')
  lines.push('')
  lines.push(`- 目标知识库 ID：${report.knowledgeBaseId}`)
  lines.push(`- 输入目录：${report.inputDir}`)
  lines.push(`- Excel：${report.excelFile}`)
  lines.push(`- 映射配置：${report.mappingFile}`)
  lines.push(`- 开始：${report.startedAt}`)
  lines.push(`- 结束：${report.finishedAt}`)
  lines.push(
    `- 合计 ${report.total} 行：成功 ${report.succeeded} / 跳过 ${report.skipped} / 失败 ${report.failed}`,
  )
  lines.push('')

  appendSection(lines, '成功清单', report.results.filter((r) => r.outcome === 'success'))
  appendSection(lines, '跳过清单（幂等：文件名已存在）', report.results.filter((r) => r.outcome === 'skipped'))
  appendSection(lines, '失败清单', report.results.filter((r) => r.outcome === 'failed'))

  return `${lines.join('\n')}\n`
}

function appendSection(lines: string[], title: string, rows: readonly IngestRowResult[]): void {
  lines.push(`## ${title}（${rows.length}）`)
  lines.push('')
  if (rows.length === 0) {
    lines.push('（空）')
    lines.push('')
    return
  }
  for (const row of rows) {
    const id = row.knowledgeId === '' ? '-' : row.knowledgeId
    const reason = row.reason === '' ? '' : ` ｜ 原因：${row.reason}`
    lines.push(`- 第 ${row.excelRow} 行 · ${row.fileName} · id=${id} · 尝试 ${row.attempts} 次${reason}`)
    lines.push(`  - custom_metadata：${JSON.stringify(row.metadata)}`)
  }
  lines.push('')
}

/** 同时落 JSON 与 Markdown（同名不同扩展名），主控既能 cat 又能 jq */
export async function writeReport(reportPath: string, report: IngestReport): Promise<{
  jsonPath: string
  textPath: string
}> {
  const base = reportPath.replace(/\.(json|md)$/i, '')
  const jsonPath = resolve(`${base}.json`)
  const textPath = resolve(`${base}.md`)
  await mkdir(dirname(jsonPath), { recursive: true })
  await mkdir(dirname(textPath), { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(textPath, renderReportText(report), 'utf8')
  return { jsonPath, textPath }
}