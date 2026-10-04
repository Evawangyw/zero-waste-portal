// 模块边界：track（无答案判定 · 任务卡验收④）
//
// 契约：judgeNoAnswer(payload) -> true | false | null（三态，规则见 docs/task-cards/T07-契约.md §5）
//
// 为什么判定放在后端而不是前端：
//  1. 规则只有一份实现，看板口径与验收脚本不会各写一套；
//  2. 前端上报的 payload 可被伪造，"无答案率"这个对外数字必须由服务端算；
//  3. 判定是纯函数，可单测（track.selftest.ts 覆盖正例/反例/未判定）。
//
// 三态说明：
//  true  = 无答案（命中无答案短语，或来源明确为空）
//  false = 有答案（来源明确非空且未命中短语）
//  null  = 未判定（拿不到回答证据：官方挂件 v0.8.2 无回答回调，浏览器里直接在挂件面板
//          里打字的提问我们拿不到 answer/sources）。未判定不计入无答案率分母，
//          否则会把"没测到"当成"有答案"，系统性低估无答案率。

/** 判定前先归一化：NFKC（全角→半角）+ 小写 + 去掉所有空白字符。
 *  这样"知识库 中 没有"、知识库中沒有、全角问号等变体命中同一条规则。 */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '')
}

/**
 * 无答案短语表（匹配前已归一化，故此处不写 (?i) 与空白类）。
 * 收窄原则：宁可漏判也不误判 —— 看板要的是"知识库确实答不上来"，
 * 把"本回答不包含个人信息"这类免责话术判成无答案会污染无答案率。
 */
const NO_ANSWER_PATTERNS: readonly RegExp[] = [
  /无法回答/,
  /无法提供(?:信息|依据)?/,
  /抱歉[，,。]?(?:无法|不能|暂不|没有|不)/,
  /(?:知识库|知识库中|知识库里|知识库内|库中|库内)(?:没有|无|未收录|找不到)/,
  /(?:没有|未)(?:找到|检索到|搜索到)/,
  /未找到(?:相关)?(?:资料|内容|文献|依据|文件)?/,
  /不(?:包含|涵盖)(?:相关)?(?:资料|内容|信息|文献)/,
  /无(?:相关)?(?:资料|内容|信息|文献|依据)/,
  /暂无(?:相关)?(?:资料|内容|数据)/,
]

/** 回答文本里是否出现无答案措辞 */
export function matchesNoAnswerPhrase(answer: string): boolean {
  const normalized = normalizeForMatch(answer)
  if (normalized === '') return false
  return NO_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized))
}

/** 从 payload 里抽出判定所需的三类证据（对外只暴露 judgeNoAnswer，这个给自测用） */
export interface AnswerEvidence {
  /** 回答文本；payload 没给 answer 时为 null */
  readonly answer: string | null
  /** 来源数组（已过滤非字符串项）；payload 没给 sources 时为 null */
  readonly sources: readonly string[] | null
  /** 显式声明有无来源；payload 没给 hasSource 时为 null */
  readonly hasSource: boolean | null
}

/** 抽证据：非对象 payload 一律当"什么都没有" */
export function readAnswerEvidence(payload: unknown): AnswerEvidence {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { answer: null, sources: null, hasSource: null }
  }
  const record = payload as Readonly<Record<string, unknown>>
  const rawAnswer = record['answer']
  const rawSources = record['sources']
  const rawHasSource = record['hasSource']

  const sources = Array.isArray(rawSources)
    ? rawSources.filter((item): item is string => typeof item === 'string')
    : null

  return {
    answer: typeof rawAnswer === 'string' ? rawAnswer : null,
    sources,
    hasSource: typeof rawHasSource === 'boolean' ? rawHasSource : null,
  }
}

/**
 * 无答案判定（三态）。判定顺序固定：短语 -> 来源数组 -> hasSource 标记。
 * 短语优先的理由：引擎偶尔一边说"无法回答"一边带上兜底来源，
 * 任务卡口径是「回答里说无法回答就算无答案」，人的表述优先于机器的兜底引用。
 */
export function judgeNoAnswer(payload: unknown): boolean | null {
  const { answer, sources, hasSource } = readAnswerEvidence(payload)
  if (answer !== null && matchesNoAnswerPhrase(answer)) return true
  if (sources !== null) return sources.length === 0
  if (hasSource !== null) return hasSource === false
  return null
}
