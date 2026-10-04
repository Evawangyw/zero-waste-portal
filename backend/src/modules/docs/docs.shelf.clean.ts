// 模块边界：docs（书架层 · 清洗）
// 契约（对外经 docs/index.ts 暴露）：cleanFileName() / parseShelfMetadata()
//
// 清洗规则按任务卡 T03 §"文件名清洗规则（PRD §9.3）"实现，三步定序：
//   1) 摘扩展名（只摘结尾的 .alnum1~10，避免把"某.某.某"里的中间点误当扩展名）
//   2) 剥文号（（X发〔2024〕15号）/ 半角 (X发[2024]15号) 一律剥掉）
//   3) 剥公文壳（"关于印发《X》的通知" / "关于X的函" → 取 X）
// 定序原因：公文壳/文号常在扩展名之前，先摘扩展名才能让后两步的 ^...$ 锚点生效。
import type { CleanResult, ParsedMetadata } from './docs.shelf.types.js'

/** custom_metadata 的四个中文字段名（WeKnora 侧就是中文键，实测确认） */
export const META_KEY_YEAR = '年份'
export const META_KEY_DOC_TYPE = '知识类型'
export const META_KEY_DOMAIN = '知识领域'
export const META_KEY_ORG = '知识发布机构'

/** 结尾扩展名：.后跟 1~10 位字母数字（覆盖 xlsx/pdf/pptx/docx/md…），不含路径分隔符 */
const EXT_RE = /\.([A-Za-z0-9]{1,10})$/

/**
 * 文号：中文/半角括号包裹 + 内含〔2024〕或[2024]年份 + 以"号"结尾。
 * 兼容 〔〕（U+3014/3015）、［］、[]、()（）六种括号混排。
 */
const DOC_NUMBER_RE =
  /[（(][^（()[\]（）]{0,40}[〔［[]\s*(?:19|20)\d{2}\s*[〕］\]][^（()[\]（）]{0,20}号[）)]/g

/** 公文壳：关于印发/印发/转发…《标题》的通知（或"…的函"） */
const NOTICE_SHELL_RE =
  /^(?:关于)?(?:印发|发布|转发)?(?:的)?《([^《》]{1,200})》\s*(?:的通知|的函|的公告|的意见|的批复)$/
/** 公文壳：无书名号版本，如"关于加强垃圾分类工作的通知" / "关于XX的函" */
const PLAIN_SHELL_RE = /^(?:关于)?(.{2,200}?)(?:的通知|的函|的公告|的意见|的批复)$/

/** 主题分隔符：半角/全角逗号、顿号、分号、竖线、空白 */
const TOPIC_SPLIT_RE = /[,，、;；|/\s]+/

/**
 * 文件名清洗。
 * @param rawName 原始文件名（可为空串）
 * @returns readableTitle 清洗后的可读标题；空输入返回空串（调用方负责回落 title）
 */
export function cleanFileName(rawName: string): CleanResult {
  const fileName = typeof rawName === 'string' ? rawName.trim() : ''

  // 1) 摘扩展名
  const extMatch = EXT_RE.exec(fileName)
  const stem = extMatch === null ? fileName : fileName.slice(0, extMatch.index)
  const ext = extMatch === null ? '' : `.${extMatch[1] ?? ''}`

  // 2) 剥文号（全局，可能一处也可能多处）
  const withoutDocNumber = stem.replace(DOC_NUMBER_RE, '').trim()

  // 3) 剥公文壳：先试带书名号的（最规范），再试无书名号的
  const afterShell = stripShell(withoutDocNumber)

  return { readableTitle: collapseSpaces(afterShell), fileName, ext }
}

/** 两级尝试剥公文壳；剥不掉就原样返回（宁可保留全名，也别把正常标题误伤成空） */
function stripShell(text: string): string {
  if (text === '') return ''

  const notice = NOTICE_SHELL_RE.exec(text)
  const candidate = notice?.[1]
  if (candidate !== undefined && candidate.trim() !== '') return candidate.trim()

  const plain = PLAIN_SHELL_RE.exec(text)
  const plainCandidate = plain?.[1]
  if (plainCandidate !== undefined && plainCandidate.trim() !== '') return plainCandidate.trim()

  return text
}

/** 合并连续空白（含全角空格 U+3000），让清洗结果稳定可比对 */
function collapseSpaces(text: string): string {
  return text.replace(/[\s\u3000]+/g, ' ').trim()
}

/**
 * 解析 custom_metadata 为书架四维度。
 * 容错口径（任务卡硬要求）：
 *  - 键缺失 / 值为 null / 值为非字符串数字 / 值为空白串 → 该维度给空串（未标注）
 *  - 知识领域支持多值（逗号/顿号/分号分隔），去重后给数组
 *  - custom_metadata 整体不是对象（如 null）→ 返回全空，不抛错
 * 绝不对空值抛异常：一条脏数据不该让整个书架 500。
 */
export function parseShelfMetadata(
  customMetadata: Readonly<Record<string, unknown>> | null | undefined,
): ParsedMetadata {
  if (typeof customMetadata !== 'object' || customMetadata === null) {
    return { year: '', org: '', docType: '', topics: [] }
  }
  return {
    year: readMetaString(customMetadata[META_KEY_YEAR]),
    org: readMetaString(customMetadata[META_KEY_ORG]),
    docType: readMetaString(customMetadata[META_KEY_DOC_TYPE]),
    topics: parseTopics(customMetadata[META_KEY_DOMAIN]),
  }
}

/** 单个元数据取值：只认非空字符串/可转字符串的原始值，其余一律空串 */
function readMetaString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  // 数字型年份（WeKnora 表单可能存成 number）也收，但要转成无小数的整串
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(0)
  }
  return ''
}

/** 知识领域 -> 主题数组；支持已经是数组的情况；去重且保序 */
function parseTopics(value: unknown): readonly string[] {
  const parts: string[] = []

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = readMetaString(item)
      if (text !== '') parts.push(...text.split(TOPIC_SPLIT_RE))
    }
  } else {
    const text = readMetaString(value)
    if (text !== '') parts.push(...text.split(TOPIC_SPLIT_RE))
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}
