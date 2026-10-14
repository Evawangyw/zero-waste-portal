// 中文 BM25：二字、三字和英文数字词。权重只用于问句，文档侧只计词频。

interface WeightedToken {
  readonly t: string
  readonly w: number
}

function tokenizeWeighted(text: string): WeightedToken[] {
  const normalized = text.toLowerCase()
  const out: WeightedToken[] = []
  const words = normalized.match(/[a-z0-9]+/g)
  if (words !== null) {
    for (const word of words) out.push({ t: word, w: 1.2 })
  }
  const chars = normalized.replace(/[a-z0-9\s]/g, '')
  for (let i = 0; i < chars.length; i += 1) {
    if (i < chars.length - 1) out.push({ t: chars.slice(i, i + 2), w: 1 })
    if (i < chars.length - 2) out.push({ t: chars.slice(i, i + 3), w: 1.5 })
  }
  return out
}

interface IndexedDoc {
  readonly len: number
  readonly tf: ReadonlyMap<string, number>
}

export interface Bm25Hit {
  readonly id: number
  readonly score: number
}

export class BM25Index {
  private readonly k1 = 1.5
  private readonly b = 0.75
  private readonly docs = new Map<number, IndexedDoc>()
  private readonly df = new Map<string, number>()
  private avgdl = 0
  private totalLen = 0

  add(id: number, text: string): void {
    if (this.docs.has(id)) return
    const tf = new Map<string, number>()
    for (const token of tokenizeWeighted(text)) {
      tf.set(token.t, (tf.get(token.t) ?? 0) + 1)
    }
    const len = tf.size === 0 ? 1 : [...tf.values()].reduce((sum, count) => sum + count, 0)
    this.docs.set(id, { len, tf })
    this.totalLen += len
    for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1)
    this.avgdl = this.totalLen / this.docs.size
  }

  search(query: string, topK: number): Bm25Hit[] {
    const weighted = tokenizeWeighted(query)
    if (weighted.length === 0 || this.docs.size === 0) return []
    const queryTerms = new Map<string, number>()
    for (const token of weighted) {
      if (!queryTerms.has(token.t)) queryTerms.set(token.t, token.w)
    }
    const total = this.docs.size
    const scores: Bm25Hit[] = []
    for (const [id, doc] of this.docs) {
      let score = 0
      for (const [term, weight] of queryTerms) {
        const freq = doc.tf.get(term) ?? 0
        if (freq === 0) continue
        const docFreq = this.df.get(term) ?? 0
        const idf = Math.log(1 + (total - docFreq + 0.5) / (docFreq + 0.5))
        const norm =
          (freq * (this.k1 + 1)) /
          (freq + this.k1 * (1 - this.b + (this.b * doc.len) / (this.avgdl || 1)))
        score += idf * norm * weight
      }
      if (score > 0) scores.push({ id, score })
    }
    scores.sort((left, right) => right.score - left.score)
    return scores.slice(0, topK)
  }
}
