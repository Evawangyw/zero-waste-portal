// 契约（模块内）：Excel 读取 + 按 mapping 生成 IngestRow
// 三条业务口径（任务卡）：
//  1) 多值字段（「垃圾分类、塑料」）拆成数组
//  2) 空值落 emptyValue（默认「未标注」，与书架口径一致）
//  3) 文件名列缺失 -> 整行报错（不能猜文件），但**不中断**其它行
import * as XLSX from 'xlsx'
import { MappingConfigError } from './ingest.mapping.js'
import type { IngestMapping, IngestRow } from './ingest.types.js'

/** 多值分隔符：半角/全角逗号、顿号、分号、竖线、斜杠、换行 */
const MULTI_SPLIT_RE = /[,，、;；|\r\n]+/

/** 一行解析失败（收集起来，最后统一进报告，不中断整批） */
export interface RowParseError {
  readonly excelRow: number
  readonly reason: string
}

export interface ExcelReadResult {
  readonly rows: readonly IngestRow[]
  readonly errors: readonly RowParseError[]
  /** 实际读到的表头（报告里留档，方便主控核对列名对不对） */
  readonly headerLine: readonly string[]
}

export function parseWorkbook(
  buffer: Uint8Array,
  mapping: IngestMapping,
): ExcelReadResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = mapping.sheet !== null ? workbook.SheetNames.includes(mapping.sheet) ? mapping.sheet : null : (workbook.SheetNames[0] ?? null)
  if (sheetName === null) {
    throw new MappingConfigError(
      `找不到工作表（配置 sheet=${String(mapping.sheet)}，实际有：${workbook.SheetNames.join('、') || '无'}）`,
    )
  }
  const sheet = workbook.Sheets[sheetName]
  if (sheet === undefined) {
    throw new MappingConfigError(`工作表 ${sheetName} 读不出内容`)
  }

  // defval:'' 让空单元格统一成空串，避免 undefined 到处漏
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  })
  const headerIndex = mapping.headerRow - 1
  const headerRaw = matrix[headerIndex]
  if (headerRaw === undefined) {
    throw new MappingConfigError(
      `mapping.headerRow=${mapping.headerRow}，但 Excel 只有 ${matrix.length} 行`,
    )
  }
  const header = headerRaw.map((cell) => normalizeText(cell))
  const headerLine = header.map((name, i) => (name === '' ? `列${i + 1}` : name))

  // 列名 -> 列下标。表头重名取首次出现，避免一条列名把两列都吃掉。
  const colIndexByName = new Map<string, number>()
  header.forEach((name, i) => {
    if (name !== '' && !colIndexByName.has(name)) colIndexByName.set(name, i)
  })

  // 配置里点名的列一个都找不到 -> 立刻报错（这类是「配置写错」，重试无意义）
  const missingColumns = mapping.fields
    .map((f) => f.column)
    .filter((name) => !colIndexByName.has(name))
  if (missingColumns.length > 0) {
    throw new MappingConfigError(
      `mapping.json 里的列名在 Excel 表头中不存在：${missingColumns.join('、')}；` +
        `实际表头：${headerLine.join(' | ')}。请改 mapping.json 的 column（不要改代码）。`,
    )
  }

  const rows: IngestRow[] = []
  const errors: RowParseError[] = []
  for (let r = headerIndex + 1; r < matrix.length; r += 1) {
    const rawRow = matrix[r]
    if (rawRow === undefined) continue
    const excelRow = r + 1
    // 全空行直接跳过（Excel 尾部常见，不该污染报告）
    if (rawRow.every((cell) => normalizeText(cell) === '')) continue

    try {
      rows.push(buildRow(rawRow, excelRow, mapping, colIndexByName))
    } catch (err) {
      errors.push({
        excelRow,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { rows, errors, headerLine }
}

function buildRow(
  rawRow: readonly unknown[],
  excelRow: number,
  mapping: IngestMapping,
  colIndexByName: ReadonlyMap<string, number>,
): IngestRow {
  const fileName = readCell(rawRow, colIndexByName, mapping.fileColumn)
  if (fileName === '') {
    throw new Error(`第 ${excelRow} 行：文件名为空，无法定位文件（映射列「${mapping.fileColumn}」）`)
  }

  const metadata: Record<string, string> = {}
  const multiValues: Record<string, readonly string[]> = {}
  for (const field of mapping.fields) {
    const cell = readCell(rawRow, colIndexByName, field.column)
    if (field.multiValue) {
      // 多值字段：拆成数组留档，但写入 WeKnora 的是 join 后的标量
      const parts = splitMultiValue(cell)
      multiValues[field.key] = parts
      metadata[field.key] =
        parts.length === 0 ? mapping.emptyValue : parts.join(mapping.multiValueJoiner)
    } else {
      metadata[field.key] = cell === '' ? mapping.emptyValue : cell
    }
  }

  return { excelRow, fileName, metadata, multiValues }
}

function readCell(
  rawRow: readonly unknown[],
  colIndexByName: ReadonlyMap<string, number>,
  column: string,
): string {
  const idx = colIndexByName.get(column)
  if (idx === undefined) {
    // 理论上 parseWorkbook 已经全量校验过；这里兜底防后续改动引入的漏网
    throw new Error(`表头缺列「${column}」`)
  }
  return normalizeText(rawRow[idx])
}

/** 多值拆分：去空白、去重、保序。空值返回空数组（由调用方落 emptyValue） */
export function splitMultiValue(cell: string): readonly string[] {
  if (cell === '') return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of cell.split(MULTI_SPLIT_RE)) {
    const trimmed = collapse(part)
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/** 单元格 -> 归一化文本：数字 2024 -> '2024'，全角空格折叠，null/undefined -> '' */
function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return collapse(String(value))
}

function collapse(value: string): string {
  return value.replace(/[\s\u3000]+/g, ' ').trim()
}