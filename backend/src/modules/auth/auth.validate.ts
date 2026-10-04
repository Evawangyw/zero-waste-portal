// 契约（模块内）：请求体校验（手写，不用 zod —— 验收①要求逐字段报错，手写更可控且零新增依赖）
// 规则来源：任务卡「注册五字段（全部必填）+ 密码」「consent=true 必传」「手机号格式校验」「关注议题为数组多选」
import type { FieldIssue, LoginBody, RegisterBody } from './auth.types.js'

/** 中国大陆手机号：1 开头，第二位 3-9，共 11 位 */
export const PHONE_PATTERN = /^1[3-9]\d{9}$/
export const MIN_PASSWORD_LENGTH = 8
/** bcrypt 只取前 72 字节，超长静默截断属隐患 —— 直接拒绝 */
export const MAX_PASSWORD_LENGTH = 72
export const MAX_NAME_LENGTH = 50
export const MAX_ORG_LENGTH = 100
export const MAX_OCCUPATION_LENGTH = 50
export const MAX_TOPIC_LENGTH = 30
export const MAX_TOPICS = 10

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] }

/** POST /api/auth/register 请求体校验 */
export function parseRegisterBody(raw: unknown): ParseResult<RegisterBody> {
  const body = asRecord(raw)
  if (body === null) return fail([{ field: 'body', message: '请求体必须是 JSON 对象' }])

  const issues: FieldIssue[] = []
  const name = readTrimmedString(body['name'])
  if (name === null) issues.push(issue('name', `姓名必填（1-${MAX_NAME_LENGTH} 字）`))
  else if (name.length > MAX_NAME_LENGTH)
    issues.push(issue('name', `姓名不得超过 ${MAX_NAME_LENGTH} 字`))

  const org = readTrimmedString(body['org'])
  if (org === null) issues.push(issue('org', `所在机构必填（1-${MAX_ORG_LENGTH} 字）`))
  else if (org.length > MAX_ORG_LENGTH)
    issues.push(issue('org', `所在机构不得超过 ${MAX_ORG_LENGTH} 字`))

  const occupation = readTrimmedString(body['occupation'])
  if (occupation === null)
    issues.push(issue('occupation', `职业必填（1-${MAX_OCCUPATION_LENGTH} 字）`))
  else if (occupation.length > MAX_OCCUPATION_LENGTH)
    issues.push(issue('occupation', `职业不得超过 ${MAX_OCCUPATION_LENGTH} 字`))

  const topics = readTopics(body['topics'])
  if (topics === null)
    issues.push(issue('topics', `关注议题必填：需为 1-${MAX_TOPICS} 个议题的字符串数组`))

  const phone = readTrimmedString(body['phone'])
  if (phone === null) issues.push(issue('phone', '联系电话必填'))
  else if (!PHONE_PATTERN.test(phone))
    issues.push(issue('phone', '联系电话格式不正确（应为 11 位手机号）'))

  const password = readPassword(body['password'])
  if (password === null)
    issues.push(issue('password', `密码必填（${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} 位）`))

  if (body['consent'] !== true)
    issues.push(issue('consent', '必须勾选同意隐私提示（consent=true）'))

  // 任一字段为空说明上面的分支已记了对应 issue（此处只做类型收口，不再补记）
  if (
    issues.length > 0 ||
    name === null ||
    org === null ||
    occupation === null ||
    topics === null ||
    phone === null ||
    password === null
  ) {
    return fail(issues)
  }
  return {
    ok: true,
    value: { name, org, occupation, topics, phone, password, consent: true },
  }
}

/** POST /api/auth/login 请求体校验（只认手机号 + 密码） */
export function parseLoginBody(raw: unknown): ParseResult<LoginBody> {
  const body = asRecord(raw)
  if (body === null) return fail([{ field: 'body', message: '请求体必须是 JSON 对象' }])

  const issues: FieldIssue[] = []
  const phone = readTrimmedString(body['phone'])
  if (phone === null) issues.push(issue('phone', '联系电话必填'))
  else if (!PHONE_PATTERN.test(phone))
    issues.push(issue('phone', '联系电话格式不正确（应为 11 位手机号）'))

  const password = readPassword(body['password'])
  if (password === null) issues.push(issue('password', '密码必填'))

  if (issues.length > 0 || phone === null || password === null) return fail(issues)
  return { ok: true, value: { phone, password } }
}

/** 关注议题：字符串数组，去重保序，长度与条数受限 */
function readTopics(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0 || value.length > MAX_TOPICS) return null
  const out: string[] = []
  for (const item of value) {
    const topic = readTrimmedString(item)
    if (topic === null || topic.length > MAX_TOPIC_LENGTH) return null
    if (!out.includes(topic)) out.push(topic)
  }
  return out
}

function readPassword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) return null
  return value
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function issue(field: string, message: string): FieldIssue {
  return { field, message }
}

function fail(issues: readonly FieldIssue[]): {
  readonly ok: false
  readonly issues: readonly FieldIssue[]
} {
  return { ok: false, issues }
}
