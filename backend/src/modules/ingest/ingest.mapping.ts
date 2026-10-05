// 契约（模块内）：inputs/mapping.json 的加载与校验
// 任务卡硬要求：真 Excel 列名有出入时**只改配置不改代码**。
// 所以这里只做「按配置里的 column 名去表头里找列」，找不到就报明确错误（附带实际表头），
// 而不是写死任何中文列名。
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { IngestFieldMapping, IngestMapping } from './ingest.types.js'

/** 配置里允许的可选键与默认值（缺省即用这些） */
const DEFAULTS = {
  headerRow: 1,
  sheet: null,
  fileColumn: '文件名',
  emptyValue: '未标注',
  multiValueJoiner: '、',
} as const

/** 映射配置加载失败（配置写错时给可操作的报错，而不是静默走默认值） */
export class MappingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MappingConfigError'
  }
}

/**
 * 读取并校验 mapping.json。
 * 校验只覆盖「结构对不对」，不校验列名是否真在 Excel 里（那要等表头出来才知道，
 * 交由 resolveRowValues 报错，那里能同时报出实际表头）。
 */
export function loadMapping(mappingPath: string): IngestMapping {
  let text: string
  try {
    text = readFileSync(mappingPath, 'utf8')
  } catch (err) {
    throw new MappingConfigError(
      `读不到映射配置 ${mappingPath}：${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new MappingConfigError(
      `${basename(mappingPath)} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!isRecord(parsed)) {
    throw new MappingConfigError(`${basename(mappingPath)} 顶层必须是 JSON 对象`)
  }

  const fields = parseFields(parsed['fields'])
  const fileColumn = readString(parsed['fileColumn'], DEFAULTS.fileColumn)
  if (!fields.some((f) => f.column === fileColumn)) {
    throw new MappingConfigError(
      `fileColumn="${fileColumn}" 必须同时出现在 fields 里（否则没法知道文件在哪一列）`,
    )
  }

  return {
    headerRow: readPositiveInt(parsed['headerRow'], DEFAULTS.headerRow, 'headerRow'),
    sheet: readNullableString(parsed['sheet'], DEFAULTS.sheet),
    fileColumn,
    emptyValue: readString(parsed['emptyValue'], DEFAULTS.emptyValue),
    multiValueJoiner: readString(parsed['multiValueJoiner'], DEFAULTS.multiValueJoiner),
    fields,
  }
}

function parseFields(raw: unknown): readonly IngestFieldMapping[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new MappingConfigError('fields 必须是非空数组，形如 [{"column":"文件名","key":"文件名"}]')
  }
  return raw.map((item, i) => {
    const at = `fields[${i}]`
    if (!isRecord(item)) throw new MappingConfigError(`${at} 必须是对象`)
    const column = readString(item['column'], '')
    const key = readString(item['key'], '')
    if (column === '') throw new MappingConfigError(`${at}.column 不能为空（Excel 表头原文）`)
    if (key === '') throw new MappingConfigError(`${at}.key 不能为空（custom_metadata 键名）`)
    const multiValue = item['multiValue']
    if (multiValue !== undefined && typeof multiValue !== 'boolean') {
      throw new MappingConfigError(`${at}.multiValue 必须是布尔值`)
    }
    return { column, key, multiValue: multiValue === true }
  })
}

function readString(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  return trimmed === '' ? fallback : trimmed
}

function readNullableString(raw: unknown, fallback: string | null): string | null {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  return trimmed === '' ? fallback : trimmed
}

function readPositiveInt(raw: unknown, fallback: number, name: string): number {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim())
    if (Number.isInteger(n) && n > 0) return n
  }
  throw new MappingConfigError(`${name} 必须是正整数（1 基行号）`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
