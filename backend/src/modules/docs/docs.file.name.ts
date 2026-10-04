// 模块边界：docs（文件层 · 元数据解析与文件名重命名）
// 契约（对外经 docs/index.ts 暴露）：parseFileMetadata() / buildDownloadFileName() / resolveExtension()
//
// 两件事，都是纯函数（不碰 DB、不碰 WeKnora），便于自测：
//  1) custom_metadata 中文键解析 -> 年份/机构/知识类型/知识领域
//  2) 下载文件名重命名："年份-机构-标题.ext"，缺年份/机构时**跳过该段**
//
// ⚠️ 容错是硬要求（任务卡）：测试库 42 条里只有 1 条填过 custom_metadata，
//    其余 41 条是 {} 或 null。所以解析必须做到：键不存在 / 值为 null /
//    值为数字 / 值为空串 / 值为嵌套对象 / 整个 custom_metadata 不是对象 —— 全部返回空值不抛错。
import {
  META_MISSING,
  type DocParsedMetadata,
  type DocParsedMetadataView,
} from './docs.file.types.js'

/** custom_metadata 的中文字段名（WeKnora 侧就是中文键，实测确认） */
export const FILE_META_KEY_YEAR = '年份'
export const FILE_META_KEY_DOC_TYPE = '知识类型'
export const FILE_META_KEY_DOMAIN = '知识领域'
export const FILE_META_KEY_ORG = '知识发布机构'

/** 领域多值分隔符：半角/全角逗号、顿号、分号、竖线、斜杠、空白 */
const TOPIC_SPLIT_RE = /[,，、;；|/\s]+/

/**
 * 解析 custom_metadata 为四维度（原始值，空 -> ''）。
 * 绝不对空值抛异常：一条脏数据不该让详情页 500。
 */
export function parseFileMetadata(
  customMetadata: Readonly<Record<string, unknown>> | null | undefined,
): DocParsedMetadata {
  if (!isRecord(customMetadata)) {
    return { year: '', org: '', docType: '', topics: [] }
  }
  return {
    year: readMetaValue(customMetadata[FILE_META_KEY_YEAR]),
    org: readMetaValue(customMetadata[FILE_META_KEY_ORG]),
    docType: readMetaValue(customMetadata[FILE_META_KEY_DOC_TYPE]),
    topics: parseTopics(customMetadata[FILE_META_KEY_DOMAIN]),
  }
}

/**
 * 展示视图：空值归一为 META_MISSING（前端统一按 '未标注' 过滤，不必判空串）。
 * topics 保持数组（空数组就是空数组，不塞哨兵 —— 数组塞字符串会破坏 .map/.includes）。
 */
export function toMetadataView(meta: DocParsedMetadata): DocParsedMetadataView {
  return {
    year: orMissing(meta.year),
    org: orMissing(meta.org),
    docType: orMissing(meta.docType),
    topics: [...meta.topics],
  }
}

/** 四个维度是否全部标注齐全（实测 42 条里只有 1 条为 true） */
export function isMetadataComplete(meta: DocParsedMetadata): boolean {
  return meta.year !== '' && meta.org !== '' && meta.docType !== '' && meta.topics.length > 0
}

/**
 * 单个元数据取值。
 * 容错清单（都是 42 条实测可能出现的形态）：
 *  - 非字符串非数字（null / undefined / 对象 / 数组 / 布尔）-> ''
 *  - 空白串（含全角空格 U+3000）-> ''
 *  - 数字 2024 / '2024' / 2024.0 -> '2024'
 */
function readMetaValue(value: unknown): string {
  if (typeof value === 'string') return collapse(value)
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(Math.trunc(value))
  }
  return ''
}

/** 领域 -> 主题数组；支持逗号/顿号/分号分隔与已经是数组的情况；去重且保序 */
function parseTopics(value: unknown): readonly string[] {
  const parts: string[] = []
  if (Array.isArray(value)) {
    for (const item of value) parts.push(...readMetaValue(item).split(TOPIC_SPLIT_RE))
  } else {
    parts.push(...readMetaValue(value).split(TOPIC_SPLIT_RE))
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const trimmed = collapse(part)
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function collapse(value: string): string {
  return value.replace(/[\s\u3000]+/g, ' ').trim()
}

function orMissing(value: string): string {
  return value === '' ? META_MISSING : value
}

// ------------------------------------------------------------------ 扩展名

/**
 * 归一化扩展名：小写、去点、去首尾空白。
 * @param fileType 上游 file_type（可能是 'pdf' / '.pdf' / 'PDF'）
 * @param fileName 原始文件名（fileType 缺失时从扩展名兜底）
 */
export function resolveExtension(
  fileType: string | null | undefined,
  fileName: string | null | undefined,
): string {
  const fromType = fileType === null || fileType === undefined ? '' : fileType.trim().toLowerCase()
  if (fromType !== '') return fromType.replace(/^\.+/, '')
  const fromName = fileName === null || fileName === undefined ? '' : fileName.trim()
  const dot = fromName.lastIndexOf('.')
  if (dot < 0 || dot === fromName.length - 1) return ''
  return fromName.slice(dot + 1).toLowerCase()
}

// ------------------------------------------------------------------ 文件名重命名

/**
 * Windows / HTTP 头里非法的文件名字符：\ / : * ? " < > | 与控制字符。
 * 统一替换为全角或半角安全字符，绝不直接透传（防目录穿越与头注入）。
 */
// eslint-disable-next-line no-control-regex -- 控制字符（\u0000-\u001F、\u007F）正是要过滤的目标，见上方注释
const ILLEGAL_NAME_CHARS_RE = /[\\/:*?"<>|\u0000-\u001F\u007F]/g
/** RFC 5987 filename* 需要百分号编码的字符 */
const NON_ASCII_OR_RESERVED_RE = /[^\x20-\x7E]|["\\]/g

/** 单段最长长度（防止极端长标题把文件名撑爆） */
const MAX_SEGMENT_LEN = 80
/** 完整文件名最长长度（留出扩展名） */
const MAX_FILE_NAME_LEN = 180

/**
 * 下载文件名重命名："年份-机构-标题.ext"。
 * 规则（任务卡）：
 *  - 缺年份/机构时**跳过该段**（不出现 "未标注"、不出现连续横线）
 *  - 标题优先用清洗后的可读标题，空则回落原标题，再空回落 'download'
 *  - 扩展名缺失时按 fileType 补，都没有就不带点
 *  - 非法字符替换、连续横线折叠、首尾空白/横线去掉
 *
 * @param year 年份（'' = 未标注 -> 跳过）
 * @param org  发布机构（'' = 未标注 -> 跳过）
 * @param title 标题（可为空 -> 回落 'download'）
 * @param ext  扩展名（不带点，可为空）
 */
export function buildDownloadFileName(
  year: string,
  org: string,
  title: string,
  ext: string,
): string {
  const segments: string[] = []
  pushSegment(segments, year)
  pushSegment(segments, org)
  pushSegment(segments, title === '' ? 'download' : title)

  let name = segments.join('-')
  name = name.replace(ILLEGAL_NAME_CHARS_RE, '-')
  // 折叠连续横线（替换非法字符后容易出现 "a---b"）
  name = name.replace(/-{2,}/g, '-')
  name = name.replace(/^[\s\-.]+|[\s\-.]+$/g, '')

  const safeExt = sanitizeExt(ext)
  if (name.length > MAX_FILE_NAME_LEN) {
    name = name.slice(0, MAX_FILE_NAME_LEN).replace(/[\s\-.]+$/g, '')
  }
  // 截断后可能正好切在多字节字符中间，这里无需处理（拼串合法即可，浏览器/文件系统按码点处理）
  return safeExt === '' ? name : `${name}.${safeExt}`
}

/** 段为空/全是空白/超长被清空时不入列（这就是「跳过该段」的落点） */
function pushSegment(segments: string[], raw: string): void {
  const cleaned = collapse(raw)
    .replace(ILLEGAL_NAME_CHARS_RE, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s\-.]+|[\s\-.]+$/g, '')
  if (cleaned === '') return
  segments.push(cleaned.length > MAX_SEGMENT_LEN ? cleaned.slice(0, MAX_SEGMENT_LEN) : cleaned)
}

/** 扩展名也过滤一次：只留字母数字与 1~10 位长度，防 "pdf/../../x" 这类注入 */
function sanitizeExt(ext: string): string {
  const cleaned = collapse(ext).toLowerCase().replace(/^\.+/, '').replace(ILLEGAL_NAME_CHARS_RE, '')
  return /^[a-z0-9]{1,10}$/.test(cleaned) ? cleaned : ''
}

/**
 * 生成 Content-Disposition 值。
 * 同时给 filename（ASCII 兜底，非 ASCII 一律 _）与 filename*（RFC 5987 UTF-8 百分号编码），
 * 老浏览器读前者、现代浏览器读后者，中文名不会乱码。
 *
 * @param disposition 'attachment'（下载）| 'inline'（预览）
 * @param fileName 已 sanitise 的文件名
 */
export function buildContentDisposition(
  disposition: 'attachment' | 'inline',
  fileName: string,
): string {
  const asciiFallback = fileName.replace(NON_ASCII_OR_RESERVED_RE, '_')
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(fileName)}`
}

/** RFC 5987 attr-char：除 attribute-char 外一律百分号编码（encodeURIComponent 已覆盖大部分） */
function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
