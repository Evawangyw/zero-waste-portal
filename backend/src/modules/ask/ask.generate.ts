// 契约（ask 模块内）：检索抽出原文之后，才用百炼根据这些原文生成回答。
// 资料回答不了的问题（例如天气）不编造，回 EMPTY_NOTICE，且不附来源。
import type { ExtractiveAnswer, ExtractiveSource } from './ask.extract.js'
import { EMPTY_NOTICE, EXTRACT_SOURCE_MARK, formatSourceAppendix } from './ask.extract.js'
import { loadBailianConfig } from './ask.bailian.js'

const GENERATION_TIMEOUT_MS = 90_000
const MAX_EVIDENCE_CHARS = 8_000

const SYSTEM_PROMPT = [
  '你是零废弃知识库的问答助手。你只能使用用户消息中的资料回答。',
  '规则：',
  '1. 只陈述资料里写明的事实。不要使用资料以外的知识，不要回答天气、闲聊、时事或任何资料没有覆盖的问题。',
  '2. 如果这些资料不能直接回答问题，只输出下面这一句，不要加任何别的字：',
  EMPTY_NOTICE,
  '3. 能回答时用简洁中文。每个事实句末标注资料编号，格式为 [[1]]。编号只能来自资料里已有的编号。',
  '4. 不要输出“参考来源”，不要输出 @@sources@@，不要输出思考过程。',
  '5. 问题里的名称和资料标题相差几个字，或用了简称时，仍按该资料回答，并使用资料里的正式名称。',
].join('\n')

export interface GenerateDecision {
  readonly action: 'generate'
  readonly evidence: string
  readonly sources: readonly ExtractiveSource[]
}

export interface RefuseDecision {
  readonly action: 'refuse'
  readonly notice: string
}

export type GroundingDecision = GenerateDecision | RefuseDecision

export interface ChatMessage {
  readonly role: 'system' | 'user'
  readonly content: string
}

/** 抽取结果为空，或抽不出可引用句子时，不调用模型。 */
export function decideGrounding(composed: ExtractiveAnswer): GroundingDecision {
  if (composed.mode === 'empty' || composed.sources.length === 0) {
    return { action: 'refuse', notice: composed.mode === 'empty' ? composed.answer : EMPTY_NOTICE }
  }
  const evidence = evidenceBody(composed.answer)
  if (evidence === '') return { action: 'refuse', notice: EMPTY_NOTICE }
  return { action: 'generate', evidence, sources: composed.sources }
}

export function buildChatMessages(query: string, evidence: string): readonly ChatMessage[] {
  const clipped = evidence.length > MAX_EVIDENCE_CHARS ? evidence.slice(0, MAX_EVIDENCE_CHARS) : evidence
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `问题：\n${query}\n\n资料：\n${clipped}` },
  ]
}

/** 模型没引用资料，或明确说库内没有依据时，对外只留固定说明。 */
export function isUngrounded(text: string, sources: readonly ExtractiveSource[]): boolean {
  const cleaned = visibleModelAnswer(text)
  if (cleaned === '') return true
  const compact = cleaned.replace(/\s+/g, '')
  const notice = EMPTY_NOTICE.replace(/\s+/g, '')
  if (compact === notice || compact.startsWith(notice)) return true
  if (
    (compact.includes('未检索到') ||
      compact.includes('没有相关内容') ||
      compact.includes('没有直接相关') ||
      compact.includes('无法根据') ||
      compact.includes('不能根据')) &&
    !citesEvidence(cleaned, sources)
  ) {
    return true
  }
  return !citesEvidence(cleaned, sources)
}

export function visibleModelAnswer(text: string): string {
  const withoutThink = stripThink(text)
  const cut = withoutThink.split(EXTRACT_SOURCE_MARK)[0] ?? withoutThink
  return cut.replace(/\n*参考来源[\s\S]*$/, '').trim()
}

export function citesEvidence(text: string, sources: readonly ExtractiveSource[]): boolean {
  const ids = new Set(sources.map((source) => source.index))
  for (const match of text.matchAll(/\[\[(\d+)\]\]/g)) {
    const raw = match[1]
    if (raw === undefined) continue
    const index = Number(raw)
    if (ids.has(index)) return true
  }
  return false
}

/** 收齐模型输出后再决定：有引用就保留回答并接上来源；否则只回库内无依据。 */
export async function collectGroundedAnswer(
  deltas: AsyncIterable<string>,
  sources: readonly ExtractiveSource[],
): Promise<string> {
  let full = ''
  for await (const delta of deltas) full += delta
  const cleaned = visibleModelAnswer(full)
  if (isUngrounded(cleaned, sources)) return EMPTY_NOTICE
  return `${cleaned}${formatSourceAppendix(sources)}`
}

export async function* streamBailianDeltas(
  query: string,
  evidence: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const config = loadBailianConfig()
  const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
  const parent = signal ?? timeout
  const combined = signal === undefined ? timeout : AbortSignal.any([parent, timeout])
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: 0.2,
      enable_thinking: false,
      messages: buildChatMessages(query, evidence),
    }),
    signal: combined,
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
  yield* readSseDeltas(response)
}

export function readBailianLine(line: string): string | 'done' | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith(':')) return null
  if (!trimmed.startsWith('data:')) return null
  const data = trimmed.slice('data:'.length).trim()
  if (data === '[DONE]') return 'done'
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  return readDeltaContent(parsed)
}

function evidenceBody(answer: string): string {
  const marked = answer.split(EXTRACT_SOURCE_MARK)[0] ?? answer
  const sourceAt = marked.lastIndexOf('\n参考来源')
  const body = sourceAt < 0 ? marked : marked.slice(0, sourceAt)
  return body.trim()
}

function stripThink(text: string): string {
  const closed = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const open = closed.toLowerCase().indexOf('<think>')
  return open < 0 ? closed : closed.slice(0, open)
}

function readDeltaContent(parsed: unknown): string | null {
  if (!isRecord(parsed)) return null
  const error = parsed['error']
  if (isRecord(error)) {
    const message = error['message']
    throw new Error(typeof message === 'string' && message !== '' ? message : '百炼调用失败')
  }
  const choices = parsed['choices']
  if (!Array.isArray(choices)) return null
  const first = choices[0]
  if (!isRecord(first)) return null
  const delta = first['delta']
  if (!isRecord(delta)) return null
  const content = delta['content']
  return typeof content === 'string' ? content : null
}

async function* readSseDeltas(response: Response): AsyncGenerator<string> {
  if (response.body === null) throw new Error('百炼没有返回内容')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    buffer += decoder.decode(step.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const delta = readBailianLine(line)
      if (delta === 'done') return
      if (delta !== null && delta !== '') yield delta
    }
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed)) {
      const error = parsed['error']
      if (isRecord(error) && typeof error['message'] === 'string' && error['message'] !== '') {
        return error['message']
      }
      if (typeof parsed['message'] === 'string' && parsed['message'] !== '') return parsed['message']
    }
  } catch {
    // 非 JSON 时只回状态码，避免把上游原文写进页面
  }
  return `百炼请求失败（HTTP ${response.status}）`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
