// 契约（ask 模块内）：把 WeKnora 检索片段抽成带 [[n]] 的原文回答。
// 不调用对话模型。栏目不按垃圾分类写死，句子只按和问句的词面重合来取。
// 回答末尾的 @@sources@@ 与前端 readExtractiveAnswer 是同一标记，改一边必须改另一边。

export const EXTRACT_SOURCE_MARK = '@@sources@@'

export interface ExtractHit {
  readonly knowledgeId: string
  readonly title: string
  readonly content: string
  readonly score: number
  readonly customMetadataText: string
}

export interface ExtractiveSource {
  readonly index: number
  readonly docId: string
  readonly title: string
  readonly organization: string
  readonly year: string
  readonly docType: string
}

export interface ExtractiveAnswer {
  readonly answer: string
  readonly mode: 'extractive' | 'empty'
  readonly sources: readonly ExtractiveSource[]
}

const EMPTY_NOTICE =
  '当前知识库中未检索到与该问题直接相关的可靠依据，建议更换关键词或在知识库中按主题浏览。'
const WEAK_NOTICE =
  '检索到相关文档，但未能从中定位到可直接回答该问题的原文表述，建议尝试更具体的问法。'

const DOC_TYPE_ORDER = ['政策法规', '各类标准', '研究报告', '案例工具'] as const
const AUTH_WEIGHT: Readonly<Record<string, number>> = {
  政策法规: 1.7,
  各类标准: 1.35,
  研究报告: 1,
  案例工具: 0.85,
}

const STOP = new Set([
  '如何',
  '何进',
  '进行',
  '对于',
  '关于',
  '哪些',
  '有哪',
  '什么',
  '怎么',
  '怎样',
  '为何',
  '请问',
  '需要',
  '要做',
  '做哪',
  '应该',
  '可以',
  '我们',
  '你们',
  '他们',
  '一下',
  '目前',
  '现在',
  '相关',
  '有关',
  '方面',
  '问题',
  '以及',
  '还是',
  '或者',
  '如何进',
  '何进行',
  '有哪些',
  '定有哪',
  '需要做',
  '要做哪',
  '做哪些',
  '么需要',
  '请问有',
  '些什么',
])

const GEO_KEYWORDS = [
  '北京',
  '上海',
  '广州',
  '深圳',
  '重庆',
  '天津',
  '杭州',
  '成都',
  '武汉',
  '南京',
  '苏州',
  '长沙',
  '郑州',
  '西安',
  '青岛',
  '宁波',
  '厦门',
  '福州',
  '济南',
  '合肥',
  '南昌',
  '昆明',
  '贵阳',
  '南宁',
  '海口',
  '兰州',
  '银川',
  '西宁',
  '乌鲁木齐',
  '拉萨',
  '沈阳',
  '长春',
  '哈尔滨',
  '石家庄',
  '太原',
  '呼和浩特',
  '大连',
  '无锡',
  '常州',
  '佛山',
  '东莞',
  '珠海',
  '浙江',
  '江苏',
  '广东',
  '山东',
  '四川',
  '湖北',
  '湖南',
  '河南',
  '河北',
  '福建',
  '安徽',
  '江西',
  '云南',
  '贵州',
  '广西',
  '海南',
  '甘肃',
  '宁夏',
  '青海',
  '新疆',
  '西藏',
  '辽宁',
  '吉林',
  '黑龙江',
  '陕西',
  '山西',
  '内蒙古',
]

const MAX_DOCS = 6
const MAX_SENTENCES = 6
const PER_DOC_SENTENCES = 3
const DOC_CUTOFF = 0.22
const SENTENCE_CUTOFF = 0.45

interface DocMeta {
  readonly year: string
  readonly org: string
  readonly docType: string
}

interface DocBucket {
  readonly knowledgeId: string
  readonly title: string
  readonly meta: DocMeta
  readonly chunks: readonly string[]
  score: number
  rscore: number
  titleGeoHit: boolean
}

interface ScoredSentence {
  readonly text: string
  readonly score: number
  readonly doc: DocBucket
}

export function composeExtractiveAnswer(
  query: string,
  hits: readonly ExtractHit[],
): ExtractiveAnswer {
  const q = query.trim()
  if (hits.length === 0) return emptyAnswer(EMPTY_NOTICE)

  const strong = strongTerms(q)
  const queryGeo = extractGeo(q)
  const cores = coreConcepts(
    strong,
    hits.map((hit) => hit.content),
  )
  const docs = rankDocs(hits, queryGeo, cores)
  if (docs.length === 0) return emptyAnswer(EMPTY_NOTICE)

  const sentences = pickSentences(docs, strong, queryGeo, cores)
  if (sentences.length === 0) return emptyAnswer(WEAK_NOTICE)

  const sources: ExtractiveSource[] = []
  const indexByDoc = new Map<string, number>()
  const lines: string[] = []
  for (const sentence of sentences) {
    let index = indexByDoc.get(sentence.doc.knowledgeId)
    if (index === undefined) {
      index = sources.length + 1
      indexByDoc.set(sentence.doc.knowledgeId, index)
      sources.push({
        index,
        docId: sentence.doc.knowledgeId,
        title: sentence.doc.title,
        organization: sentence.doc.meta.org,
        year: sentence.doc.meta.year,
        docType: sentence.doc.meta.docType,
      })
    }
    lines.push(`${sentence.text} [[${index}]]`)
  }

  const sourceLines = sources.map((source) => {
    const tail = [source.organization, source.year].filter((part) => part !== '').join('，')
    return tail === ''
      ? `[[${source.index}]] ${wrapTitle(source.title)}`
      : `[[${source.index}]] ${wrapTitle(source.title)}，${tail}`
  })
  const answer = [
    lines.join('\n\n'),
    '',
    '参考来源',
    sourceLines.join('\n'),
    `${EXTRACT_SOURCE_MARK}${JSON.stringify(sources)}`,
  ].join('\n')
  return { answer, mode: 'extractive', sources }
}

function emptyAnswer(notice: string): ExtractiveAnswer {
  return { answer: notice, mode: 'empty', sources: [] }
}

function rankDocs(
  hits: readonly ExtractHit[],
  queryGeo: ReadonlySet<string>,
  cores: readonly string[],
): DocBucket[] {
  const byDoc = new Map<string, { hit: ExtractHit; chunks: string[]; scores: number[] }>()
  for (const hit of hits) {
    const cur = byDoc.get(hit.knowledgeId)
    if (cur === undefined) {
      byDoc.set(hit.knowledgeId, { hit, chunks: [hit.content], scores: [hit.score] })
    } else {
      cur.chunks.push(hit.content)
      cur.scores.push(hit.score)
    }
  }

  const docs: DocBucket[] = []
  for (const group of byDoc.values()) {
    const scores = [...group.scores].sort((a, b) => b - a)
    const score = (scores[0] ?? 0) + scores.slice(1).reduce((sum, item) => sum + item * 0.3, 0)
    const title = cleanTitle(group.hit.title)
    const meta = parseMeta(group.hit.customMetadataText, title)
    const titleGeoHit = [...queryGeo].some((geo) => title.includes(geo))
    docs.push({
      knowledgeId: group.hit.knowledgeId,
      title,
      meta,
      chunks: group.chunks,
      score,
      rscore: score,
      titleGeoHit,
    })
  }

  for (const doc of docs) {
    const blob = `${doc.title}\n${doc.chunks.join('\n')}`.toLowerCase()
    const coreHits = cores.filter((core) => blob.includes(core)).length
    const geoBoost = doc.titleGeoHit ? 15 : queryGeoMentions(doc.chunks, queryGeo) ? 1.8 : 1
    const auth = AUTH_WEIGHT[doc.meta.docType] ?? 1
    doc.rscore = doc.score * (1 + coreHits) * auth * geoBoost
  }
  docs.sort((a, b) => b.rscore - a.rscore)
  const best = docs[0]?.rscore ?? 0
  const cutoff = best * DOC_CUTOFF
  const kept = [
    ...docs.filter((doc) => doc.titleGeoHit),
    ...docs.filter((doc) => !doc.titleGeoHit && doc.rscore >= cutoff),
  ].slice(0, MAX_DOCS)
  kept.sort((a, b) => {
    const ai = typeRank(a.meta.docType)
    const bi = typeRank(b.meta.docType)
    if (ai !== bi) return ai - bi
    return b.rscore - a.rscore
  })
  return kept
}

function pickSentences(
  docs: readonly DocBucket[],
  strong: ReadonlySet<string>,
  queryGeo: ReadonlySet<string>,
  cores: readonly string[],
): ScoredSentence[] {
  const picked: ScoredSentence[] = []
  for (const doc of docs) {
    const ranked = doc.chunks
      .flatMap((chunk) => splitSentences(chunk))
      .map((text) => ({ text, score: scoreSentence(text, strong), doc }))
      .filter((item) => item.score > 0)
      .filter((item) => hitsChineseIfAsked(item.text, strong))
      .filter((item) => acceptsSentence(item.text, doc, cores))
      .filter((item) => keepForGeo(item.text, doc, queryGeo))
      .sort((a, b) => b.score - a.score)
    const seen: string[] = []
    for (const item of ranked) {
      if (seen.length >= PER_DOC_SENTENCES) break
      if (seen.some((prev) => isDup(prev, item.text))) continue
      seen.push(item.text)
      picked.push(item)
    }
  }
  const best = picked.reduce((max, item) => (item.score > max ? item.score : max), 0)
  const floor = best * SENTENCE_CUTOFF
  const survivors = picked.filter((item) => item.score >= floor)
  const ordered = [...survivors].sort((a, b) => {
    const ai = typeRank(a.doc.meta.docType)
    const bi = typeRank(b.doc.meta.docType)
    if (ai !== bi) return ai - bi
    if (a.doc.rscore !== b.doc.rscore) return b.doc.rscore - a.doc.rscore
    return b.score - a.score
  })
  const globalSeen: string[] = []
  const out: ScoredSentence[] = []
  for (const item of ordered) {
    if (out.length >= MAX_SENTENCES) break
    if (globalSeen.some((prev) => isDup(prev, item.text))) continue
    globalSeen.push(item.text)
    out.push(item)
  }
  return out
}

function hitsChineseIfAsked(text: string, strong: ReadonlySet<string>): boolean {
  const chinese = [...strong].filter((term) => /[\u4e00-\u9fff]/.test(term))
  if (chinese.length === 0) return true
  return chinese.some((term) => text.includes(term))
}

function acceptsSentence(text: string, doc: DocBucket, cores: readonly string[]): boolean {
  const compact = text.replace(/\s+/g, '')
  if (compact.includes('参考文献') || compact.includes('专利') || compact.includes('起草')) return false
  if (/\[\s*\d+\s*\]/.test(text)) return false
  const top = cores[0]
  if (top === undefined) return true
  return `${doc.title}\n${text}`.toLowerCase().includes(top)
}

function keepForGeo(text: string, doc: DocBucket, queryGeo: ReadonlySet<string>): boolean {
  if (queryGeo.size === 0 || doc.titleGeoHit) return true
  if (![...queryGeo].some((geo) => text.includes(geo))) return false
  return GEO_KEYWORDS.every((geo) => queryGeo.has(geo) || !text.includes(geo))
}

function queryGeoMentions(chunks: readonly string[], queryGeo: ReadonlySet<string>): boolean {
  if (queryGeo.size === 0) return false
  const blob = chunks.join('\n')
  return [...queryGeo].some((geo) => blob.includes(geo))
}

function splitSentences(chunk: string): string[] {
  const stripped = chunk.replace(/<[^>]+>/g, ' ')
  const lines = stripped
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
  const out: string[] = []
  for (const line of lines) {
    const cleaned = line.replace(/^#{1,6}\s+/, '').trim()
    if (cleaned === '' || isNoiseLine(cleaned)) continue
    if (cleaned.length <= 160) {
      out.push(cleaned)
      continue
    }
    for (const part of cleaned.split(/(?<=[。！？；])/)) {
      const text = part.trim()
      if (text !== '' && !isNoiseLine(text)) out.push(text)
    }
  }
  return out
}

function isNoiseLine(line: string): boolean {
  if (line.length < 8) return true
  if (/[？?]\s*$/.test(line)) return true
  if (/^!\[[^\]]*\]/.test(line)) return true
  if (/^[-|:\s]+$/.test(line)) return true
  return false
}

function scoreSentence(sentence: string, strong: ReadonlySet<string>): number {
  const terms = strongTerms(sentence)
  let score = 0
  for (const term of strong) {
    if (terms.has(term)) score += term.length > 2 ? 1.5 : 1
  }
  return score
}

function strongTerms(text: string): Set<string> {
  const normalized = text.toLowerCase()
  const set = new Set<string>()
  for (const word of normalized.match(/[a-z0-9]+/g) ?? []) {
    if (word.length >= 2) set.add(word)
  }
  const chars = normalized.replace(/[a-z0-9\s]/g, '')
  for (let i = 0; i < chars.length; i += 1) {
    if (i < chars.length - 1) {
      const bigram = chars.slice(i, i + 2)
      if (!STOP.has(bigram)) set.add(bigram)
    }
    if (i < chars.length - 2) {
      const trigram = chars.slice(i, i + 3)
      if (!STOP.has(trigram)) set.add(trigram)
    }
  }
  return set
}

function coreConcepts(queryTerms: ReadonlySet<string>, chunks: readonly string[]): string[] {
  const lowered = chunks.map((chunk) => chunk.toLowerCase())
  const total = lowered.length || 1
  const ranked: { term: string; idf: number }[] = []
  for (const term of queryTerms) {
    if (term.length < 2) continue
    const df = lowered.filter((chunk) => chunk.includes(term)).length
    if (df === 0) continue
    ranked.push({ term, idf: Math.log(1 + (total - df + 0.5) / (df + 0.5)) })
  }
  ranked.sort((a, b) => b.idf - a.idf)
  const best = ranked[0]?.idf ?? 0
  if (best === 0) return []
  const minIdf = best * 0.55
  const out: string[] = []
  for (const item of ranked) {
    if (item.idf < minIdf) break
    if (!out.includes(item.term)) out.push(item.term)
    if (out.length >= 3) break
  }
  return out
}

function extractGeo(text: string): Set<string> {
  const found = new Set<string>()
  for (const geo of GEO_KEYWORDS) {
    if (text.includes(geo)) found.add(geo)
  }
  return found
}

function parseMeta(raw: string, title: string): DocMeta {
  const meta: { year: string; org: string; docType: string } = { year: '', org: '', docType: '' }
  const text = raw.trim()
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text) as unknown
      if (isRecord(parsed)) {
        meta.year = readMeta(parsed, '知识发布年份') || readMeta(parsed, '年份')
        meta.org = readMeta(parsed, '知识发布机构')
        meta.docType = readMeta(parsed, '知识类型')
      }
    } catch {
      // 不是 JSON 就按「键: 值」行解析
    }
  }
  if (meta.docType === '' || meta.org === '' || meta.year === '') {
    for (const line of text.split(/\n/)) {
      const colon = line.indexOf(':')
      if (colon <= 0) continue
      const key = line.slice(0, colon).trim()
      const value = line.slice(colon + 1).trim()
      if (value === '') continue
      if (key === '知识类型' && meta.docType === '') meta.docType = value
      if (key === '知识发布机构' && meta.org === '') meta.org = value
      if ((key === '知识发布年份' || key === '年份') && meta.year === '') meta.year = value
    }
  }
  if (meta.docType === '') meta.docType = inferDocType(title)
  return meta
}

function inferDocType(title: string): string {
  if (/GB\s*[/／]\s*T/i.test(title) || /GB[\s-]?\d/.test(title)) return '各类标准'
  return ''
}

function typeRank(docType: string): number {
  const index = DOC_TYPE_ORDER.indexOf(docType as (typeof DOC_TYPE_ORDER)[number])
  return index === -1 ? DOC_TYPE_ORDER.length : index
}

function cleanTitle(title: string): string {
  return title.replace(/\.pdf$/i, '').trim()
}

function wrapTitle(title: string): string {
  return /《.+》/.test(title) ? title : `《${title}》`
}

function norm(text: string): string {
  return text.replace(/[\s，。；、：""''《》（）()[\]【】!?！？.,;:]/g, '')
}

function isDup(left: string, right: string): boolean {
  const a = norm(left)
  const b = norm(right)
  if (a === '' || b === '') return false
  if (a === b) return true
  const short = a.length < b.length ? a : b
  const long = a.length < b.length ? b : a
  return long.includes(short) && short.length / long.length >= 0.66
}

function readMeta(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
