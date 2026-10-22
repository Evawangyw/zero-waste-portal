// 契约（ask 模块内）：把融合后的检索片段抽成带 [[n]] 的原文回答。
// 不调用对话模型。词法命中的句子按字面重合来取；向量单独召回的片段另留少量原句。
// 问「有哪些章节 / 目录」时，改从命中文档的目录片段按原文顺序取编、章，不再要求每一行都重复法规名称。
// 回答末尾的 @@sources@@ 与前端 readExtractiveAnswer 是同一标记，改一边必须改另一边。

export const EXTRACT_SOURCE_MARK = '@@sources@@'

export interface ExtractHit {
  readonly knowledgeId: string
  readonly title: string
  readonly content: string
  readonly score: number
  readonly customMetadataText: string
  /** 缺省按词法命中处理。向量单独召回的片段允许在没有共同字面时留下少量原句。 */
  readonly channel?: 'lexical' | 'vector'
  /** 语料切片编号。目录补全靠它把同一文档的目录片段按原文顺序接上。 */
  readonly chunkId?: number
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
  readonly mode: 'extractive' | 'outline' | 'empty'
  readonly sources: readonly ExtractiveSource[]
}

export const EMPTY_NOTICE =
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
const VECTOR_PER_DOC = 2
const VECTOR_GLOBAL = 4
const DOC_CUTOFF = 0.22
const SENTENCE_CUTOFF = 0.45
const MAX_OUTLINE_LINES = 80
const OUTLINE_HEADING = /^第[零〇一二三四五六七八九十百千0-9]+(?:分编|编|章)/
const ARTICLE_HEADING = /^第[零〇一二三四五六七八九十百千0-9]+条/

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
  readonly vectorChunks: readonly string[]
  score: number
  rscore: number
  titleGeoHit: boolean
}

interface ScoredSentence {
  readonly text: string
  readonly score: number
  readonly doc: DocBucket
  readonly vectorOnly: boolean
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

  const outlined = pickOutline(docs, q)
  const sentences = outlined ?? pickSentences(docs, strong, queryGeo)
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

  const answer = `${lines.join('\n\n')}${formatSourceAppendix(sources)}`
  return { answer, mode: outlined === null ? 'extractive' : 'outline', sources }
}

/** 回答末尾的来源列表。前端靠 @@sources@@ 画卡片，生成式回答也接这一段。 */
export function formatSourceAppendix(sources: readonly ExtractiveSource[]): string {
  if (sources.length === 0) return ''
  const sourceLines = sources.map((source) => {
    const tail = [source.organization, source.year].filter((part) => part !== '').join('，')
    return tail === ''
      ? `[[${source.index}]] ${wrapTitle(source.title)}`
      : `[[${source.index}]] ${wrapTitle(source.title)}，${tail}`
  })
  return `\n\n参考来源\n${sourceLines.join('\n')}\n${EXTRACT_SOURCE_MARK}${JSON.stringify(sources)}`
}

function emptyAnswer(notice: string): ExtractiveAnswer {
  return { answer: notice, mode: 'empty', sources: [] }
}

/** 问题是在要一部资料的目录，而不是在问某一条怎么规定。 */
export function isOutlineQuery(query: string): boolean {
  return /哪些章|章节有哪|的目录|有几章|有几编|分几编|篇章结构/.test(query)
}

/** 去掉「有哪些章节」这类问法，留下资料名称。短于 4 个字时不当成名称。 */
export function outlineSubject(query: string): string {
  return query
    .replace(/请问|一下|里面|其中|关于|有哪些|哪些|什么|怎么|如何|目录|章节|篇章|结构|包括|有几编|有几章|分几编|分别是|是什么/g, '')
    .replace(/[的有里吗呢啊吧？?，,。\s]/g, '')
}

export function titleHasOutlineSubject(title: string, subject: string): boolean {
  return subject.length >= 4 && cleanTitle(title).includes(subject)
}

/** 这一片段是目录：编/章标题密集，而且没有条文。 */
export function isOutlineChunk(content: string): boolean {
  let headings = 0
  let articles = 0
  for (const line of plainLines(content)) {
    if (isOutlineHeading(line)) headings += 1
    else if (ARTICLE_HEADING.test(line)) articles += 1
  }
  return headings >= 4 && articles === 0
}

/**
 * 问目录时，把同一文档的目录片段按切片顺序合成一条，放到命中结果最前面。
 * sameDocument 只需要这部文档的切片；其他文档的命中原样保留。
 */
export function supplementOutlineHits(
  query: string,
  hits: readonly ExtractHit[],
  sameDocument: readonly ExtractHit[],
): ExtractHit[] {
  if (!isOutlineQuery(query)) return [...hits]
  const subject = outlineSubject(query)
  let best: ExtractHit | undefined
  for (const hit of hits) {
    if (!titleHasOutlineSubject(hit.title, subject)) continue
    if (best === undefined || hit.score > best.score) best = hit
  }
  if (best === undefined) return [...hits]
  const matched = best
  const outline = sameDocument
    .filter((hit) => hit.knowledgeId === matched.knowledgeId && isOutlineChunk(hit.content))
    .sort((left, right) => (left.chunkId ?? 0) - (right.chunkId ?? 0))
  if (outline.length === 0) return [...hits]
  const covered = new Set(
    outline.map((hit) => hit.chunkId).filter((id): id is number => id !== undefined),
  )
  const tail = outlineTail(sameDocument, outline)
  const body = outline.map((hit) => hit.content).join('\n')
  const synthetic: ExtractHit = {
    knowledgeId: matched.knowledgeId,
    title: matched.title,
    content: tail === '' ? body : `${body}\n${tail}`,
    score: matched.score + 1,
    customMetadataText: matched.customMetadataText,
    channel: 'lexical',
  }
  const rest = hits.filter((hit) => hit.chunkId === undefined || !covered.has(hit.chunkId))
  return [synthetic, ...rest]
}

/** 目录最后一片常常把「附则」和正文第一条切在一起。第一条之前的标题仍算目录。 */
function outlineTail(all: readonly ExtractHit[], outline: readonly ExtractHit[]): string {
  const last = outline[outline.length - 1]
  if (last === undefined || last.chunkId === undefined) return ''
  const lastId = last.chunkId
  const next = all
    .filter((hit) => hit.knowledgeId === last.knowledgeId && (hit.chunkId ?? -1) > lastId)
    .sort((left, right) => (left.chunkId ?? 0) - (right.chunkId ?? 0))[0]
  if (next === undefined) return ''
  const lines: string[] = []
  for (const line of plainLines(next.content)) {
    if (ARTICLE_HEADING.test(line)) break
    lines.push(line)
  }
  return lines.join('\n')
}

function pickOutline(docs: readonly DocBucket[], query: string): ScoredSentence[] | null {
  if (!isOutlineQuery(query)) return null
  const subject = outlineSubject(query)
  const doc = docs.find((item) => titleHasOutlineSubject(item.title, subject))
  if (doc === undefined) return null
  const chunks = [...doc.chunks, ...doc.vectorChunks].filter((chunk) => isOutlineChunk(chunk))
  if (chunks.length === 0) return null
  const richest = chunks.reduce((best, chunk) =>
    outlineHeadingCount(chunk) > outlineHeadingCount(best) ? chunk : best,
  )
  const richestCount = outlineHeadingCount(richest)
  const total = chunks.reduce((sum, chunk) => sum + outlineHeadingCount(chunk), 0)
  const source = richestCount >= total - richestCount ? [richest] : chunks
  const lines: string[] = []
  if (doc.title !== '') lines.push(doc.title)
  const seenCatalog = source.some((chunk) => plainLines(chunk).some((line) => line === '目录'))
  if (seenCatalog) lines.push('目录')
  let done = false
  for (const chunk of source) {
    if (done) break
    for (const line of plainLines(chunk)) {
      if (!isOutlineHeading(line)) continue
      if (lines[lines.length - 1] === line) continue
      // 正文又从第一编开始。目录里同一编名只出现一次，再见到就停。
      if (/^第[零〇一二三四五六七八九十百千0-9]+编/.test(line) && lines.includes(line)) {
        done = true
        break
      }
      lines.push(line)
      if (lines.length >= MAX_OUTLINE_LINES) done = true
      if (done) break
    }
  }
  if (lines.length < 5) return null
  return lines.map((text) => ({ text, score: 1, doc, vectorOnly: false }))
}

function outlineHeadingCount(content: string): number {
  let count = 0
  for (const line of plainLines(content)) {
    if (isOutlineHeading(line)) count += 1
  }
  return count
}

function isOutlineHeading(line: string): boolean {
  return line.length <= 48 && OUTLINE_HEADING.test(line)
}

function plainLines(content: string): string[] {
  return content
    .replace(/<[^>]+>/g, ' ')
    .split(/\n+/)
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
}

function rankDocs(
  hits: readonly ExtractHit[],
  queryGeo: ReadonlySet<string>,
  cores: readonly string[],
): DocBucket[] {
  const byDoc = new Map<
    string,
    { hit: ExtractHit; chunks: string[]; vectorChunks: string[]; scores: number[] }
  >()
  for (const hit of hits) {
    const cur = byDoc.get(hit.knowledgeId)
    const intoVector = hit.channel === 'vector'
    if (cur === undefined) {
      byDoc.set(hit.knowledgeId, {
        hit,
        chunks: intoVector ? [] : [hit.content],
        vectorChunks: intoVector ? [hit.content] : [],
        scores: [hit.score],
      })
    } else {
      if (intoVector) cur.vectorChunks.push(hit.content)
      else cur.chunks.push(hit.content)
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
      vectorChunks: group.vectorChunks,
      score,
      rscore: score,
      titleGeoHit,
    })
  }

  for (const doc of docs) {
    const blob = `${doc.title}\n${doc.chunks.join('\n')}\n${doc.vectorChunks.join('\n')}`.toLowerCase()
    const coreHits = cores.filter((core) => blob.includes(core)).length
    const geoBoost = doc.titleGeoHit
      ? 15
      : queryGeoMentions([...doc.chunks, ...doc.vectorChunks], queryGeo)
        ? 1.8
        : 1
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
): ScoredSentence[] {
  const picked: ScoredSentence[] = []
  for (const doc of docs) {
    const ranked = doc.chunks
      .flatMap((chunk) => splitSentences(chunk))
      .map((text) => ({ text, score: scoreSentence(text, strong), doc, vectorOnly: false }))
      .filter((item) => item.score > 0)
      .filter((item) => hitsChineseIfAsked(item.text, strong))
      .filter((item) => acceptsSentence(item.text))
      .filter((item) => keepForGeo(item.text, doc, queryGeo))
      .sort((a, b) => b.score - a.score)
    const seen: string[] = []
    for (const item of ranked) {
      if (seen.length >= PER_DOC_SENTENCES) break
      if (seen.some((prev) => isDup(prev, item.text))) continue
      seen.push(item.text)
      picked.push(item)
    }
    const vectorRanked = doc.vectorChunks
      .flatMap((chunk) => splitSentences(chunk))
      .map((text) => ({ text, score: scoreSentence(text, strong), doc, vectorOnly: true }))
      .filter((item) => keepForGeo(item.text, doc, queryGeo))
      .sort((a, b) => b.score - a.score)
    let vectorKept = 0
    for (const item of vectorRanked) {
      if (vectorKept >= VECTOR_PER_DOC) break
      if (seen.some((prev) => isDup(prev, item.text))) continue
      seen.push(item.text)
      picked.push(item)
      vectorKept += 1
    }
  }
  const best = picked.reduce((max, item) => (item.score > max ? item.score : max), 0)
  const floor = best * SENTENCE_CUTOFF
  const survivors = picked.filter((item) => item.vectorOnly || item.score >= floor)
  const ordered = [...survivors].sort((a, b) => {
    const ai = typeRank(a.doc.meta.docType)
    const bi = typeRank(b.doc.meta.docType)
    if (ai !== bi) return ai - bi
    if (a.doc.rscore !== b.doc.rscore) return b.doc.rscore - a.doc.rscore
    return b.score - a.score
  })
  const globalSeen: string[] = []
  const out: ScoredSentence[] = []
  let vectorKept = 0
  for (const item of ordered) {
    if (out.length >= MAX_SENTENCES) break
    if (item.vectorOnly && vectorKept >= VECTOR_GLOBAL) continue
    if (globalSeen.some((prev) => isDup(prev, item.text))) continue
    globalSeen.push(item.text)
    if (item.vectorOnly) vectorKept += 1
    out.push(item)
  }
  return out
}

function hitsChineseIfAsked(text: string, strong: ReadonlySet<string>): boolean {
  const chinese = [...strong].filter((term) => /[\u4e00-\u9fff]/.test(term))
  if (chinese.length === 0) return true
  return chinese.some((term) => text.includes(term))
}

function acceptsSentence(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (compact.includes('参考文献') || compact.includes('专利') || compact.includes('起草')) return false
  if (/\[\s*\d+\s*\]/.test(text)) return false
  return true
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
