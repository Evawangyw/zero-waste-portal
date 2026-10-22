// 词法召回和向量召回按名次融合，再交给抽取式回答。向量索引未完成时先只用词法。
import { getPrisma } from '../../db/prisma.js'
import { isOutlineQuery, outlineSubject, supplementOutlineHits, titleHasOutlineSubject } from './ask.extract.js'
import type { ExtractHit } from './ask.extract.js'
import { BM25Index } from './ask.bm25.js'
import type { CorpusChunk } from './ask.corpus.js'
import { loadCorpus } from './ask.corpus.js'
import { buildVectorMatrix, embedTexts, loadVectorMatrix, queryText, readVectorIndexModel, searchVectors } from './ask.embed.js'
import { peekAskSettings } from '../settings/settings.store.js'
import { fuseRanks } from './ask.fusion.js'

export interface RetrieveResult {
  readonly hits: readonly ExtractHit[]
  readonly lexicalCount: number
  readonly vectorCount: number
  readonly vectorReady: boolean
  readonly vectorDone: number
  readonly vectorTotal: number
}

interface Engine {
  chunks: CorpusChunk[]
  byId: Map<number, CorpusChunk>
  readonly bm25: BM25Index
  vectors: Float32Array | null
  vectorDim: number
  vectorReady: boolean
  vectorDone: number
  vectorTotal: number
}

let engineTask: Promise<Engine> | null = null

/** 把刚入库的切片补进当前问答索引。进程还没加载语料时，下次提问会自己读到。 */
export async function rememberIngestedChunks(added: readonly CorpusChunk[]): Promise<void> {
  if (added.length === 0 || engineTask === null) return
  const engine = await engineTask
  for (const chunk of added) {
    if (engine.byId.has(chunk.chunkId)) continue
    engine.byId.set(chunk.chunkId, chunk)
    engine.chunks.push(chunk)
    engine.bm25.add(chunk.chunkId, chunk.content)
  }
}

export function retrieve(query: string): Promise<RetrieveResult> {
  engineTask ??= openEngine()
  return engineTask.then((engine) => search(engine, query))
}

async function openEngine(): Promise<Engine> {
  const chunks = await loadCorpus()
  const bm25 = new BM25Index()
  const byId = new Map<number, CorpusChunk>()
  for (const chunk of chunks) {
    byId.set(chunk.chunkId, chunk)
    bm25.add(chunk.chunkId, chunk.content)
  }
  const cached = loadVectorMatrix(chunks.map((chunk) => chunk.chunkId))
  const engine: Engine = {
    chunks,
    byId,
    bm25,
    vectors: cached?.data ?? null,
    vectorDim: cached?.dim ?? 0,
    vectorReady: cached !== null,
    vectorDone: cached === null ? 0 : chunks.length,
    vectorTotal: chunks.length,
  }
  if (!engine.vectorReady) {
    const indexed = readVectorIndexModel()
    const wanted = peekAskSettings().vectorModel
    if (indexed !== null && indexed !== wanted) {
      console.log(`[ask] 向量索引是 ${indexed}，当前设置是 ${wanted}，暂不重建，本次只用词法召回`)
    } else {
      void warmVectors(engine)
    }
  } else console.log(`[ask] 已载入语料 ${chunks.length} 条，向量索引就绪`)
  return engine
}

async function warmVectors(engine: Engine): Promise<void> {
  try {
    console.log(`[ask] 开始构建向量索引，共 ${engine.vectorTotal} 条`)
    const matrix = await buildVectorMatrix(engine.chunks)
    const dim = engine.chunks.length === 0 ? 0 : matrix.length / engine.chunks.length
    engine.vectors = matrix
    engine.vectorDim = dim
    engine.vectorDone = engine.chunks.length
    engine.vectorReady = true
    console.log('[ask] 向量索引已就绪')
  } catch (err) {
    console.error('[ask] 向量索引构建失败，问答继续只用词法召回', err)
  }
}

async function search(engine: Engine, query: string): Promise<RetrieveResult> {
  const unlisted = await loadUnlistedIds()
  const listedChunk = (id: number): boolean => {
    if (unlisted.size === 0) return true
    const chunk = engine.byId.get(id)
    return chunk !== undefined && !unlisted.has(String(chunk.documentId))
  }
  const limits = peekAskSettings()
  const lexical = engine.bm25.search(query, limits.lexicalK).filter((hit) => listedChunk(hit.id))
  const lexicalIds = new Set(lexical.map((hit) => hit.id))
  let vector: { id: number; score: number }[] = []
  if (engine.vectorReady && engine.vectors !== null) {
    const embedded = await embedTexts([queryText(query)])
    const row = embedded.data
    vector = searchVectors(
      engine.vectors,
      engine.vectorDim,
      engine.chunks.map((chunk) => chunk.chunkId),
      row,
      limits.vectorK,
    )
    vector = vector.filter((hit) => listedChunk(hit.id))
  }
  const vectorOnly = new Set(vector.map((hit) => hit.id).filter((id) => !lexicalIds.has(id)))
  const fused = fuseRanks([lexical.map((hit) => hit.id), vector.map((hit) => hit.id)], limits.fusedK)
  const hits: ExtractHit[] = []
  for (const item of fused) {
    const chunk = engine.byId.get(item.id)
    if (chunk === undefined) continue
    hits.push({
      knowledgeId: String(chunk.documentId),
      title: chunk.title,
      content: chunk.content,
      score: item.score,
      customMetadataText: metaText(chunk),
      channel: vectorOnly.has(item.id) ? 'vector' : 'lexical',
      chunkId: chunk.chunkId,
    })
  }
  return {
    hits: expandOutline(query, hits, engine),
    lexicalCount: lexical.length,
    vectorCount: vector.length,
    vectorReady: engine.vectorReady,
    vectorDone: engine.vectorDone,
    vectorTotal: engine.vectorTotal,
  }
}

/** 问目录时，把同一文档里没进前 40 的目录片段接上。后面的片段往往不再重复法规名，单靠问句打分进不来。 */
function expandOutline(query: string, hits: readonly ExtractHit[], engine: Engine): ExtractHit[] {
  if (!isOutlineQuery(query)) return [...hits]
  const subject = outlineSubject(query)
  let best: ExtractHit | undefined
  for (const hit of hits) {
    if (!titleHasOutlineSubject(hit.title, subject)) continue
    if (best === undefined || hit.score > best.score) best = hit
  }
  if (best === undefined) return [...hits]
  const matched = best
  const extras: ExtractHit[] = []
  for (const chunk of engine.chunks) {
    if (String(chunk.documentId) !== matched.knowledgeId) continue
    extras.push({
      knowledgeId: matched.knowledgeId,
      title: chunk.title,
      content: chunk.content,
      score: 0,
      customMetadataText: metaText(chunk),
      chunkId: chunk.chunkId,
    })
  }
  return supplementOutlineHits(query, hits, extras)
}

/** 已下架的资料编号。每次提问现查，下架立刻从回答里消失。 */
async function loadUnlistedIds(): Promise<ReadonlySet<string>> {
  const rows = await getPrisma().knowledgeIndex.findMany({
    where: { listed: false },
    select: { knowledgeId: true },
  })
  return new Set(rows.map((row) => row.knowledgeId))
}

function metaText(chunk: CorpusChunk): string {
  return [
    `知识类型: ${chunk.docType}`,
    `知识发布机构: ${chunk.organization}`,
    `知识发布年份: ${chunk.year}`,
  ].join('\n')
}
