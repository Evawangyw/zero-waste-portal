// 中文向量模型 bge-small-zh。问句加检索指令，正文不加。向量按模型名和切片 id 落在 data/ask-vectors。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CorpusChunk } from './ask.corpus.js'
import { vectorCacheDir } from './ask.corpus.js'
import { peekAskSettings } from '../settings/settings.store.js'

function currentVectorModel(): string {
  return peekAskSettings().vectorModel
}
const QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：'
const PASSAGE_CHARS = 480
const BATCH = 16
// q8 权重在 onnx/model_quantized.onnx。transformers 4.3.1 不读 HF_ENDPOINT。
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'] as const

interface VectorMeta {
  readonly model: string
  readonly dim: number
  readonly chunkIds: readonly number[]
}

type EmbedCall = (
  texts: readonly string[],
  options: { readonly pooling: 'mean'; readonly normalize: true },
) => Promise<unknown>

let embedCall: EmbedCall | null = null

export function vectorPaths(dir: string = vectorCacheDir()): { dir: string; meta: string; data: string } {
  return { dir, meta: resolve(dir, 'meta.json'), data: resolve(dir, 'vectors.f32') }
}

export async function embedTexts(texts: readonly string[]): Promise<{ dim: number; data: Float32Array }> {
  const embedder = await getEmbedder()
  const output: unknown = await embedder(texts, { pooling: 'mean', normalize: true })
  return readTensor(output, texts.length)
}

export function passageText(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  return compact.length <= PASSAGE_CHARS ? compact : compact.slice(0, PASSAGE_CHARS)
}

export function queryText(query: string): string {
  return `${QUERY_PREFIX}${query.trim()}`
}

export function loadVectorMatrix(
  chunkIds: readonly number[],
): { dim: number; data: Float32Array } | null {
  const paths = vectorPaths()
  if (!existsSync(paths.meta) || !existsSync(paths.data)) return null
  const meta = readMeta(paths.meta)
  if (meta === null || meta.model !== currentVectorModel() || !sameIds(meta.chunkIds, chunkIds)) return null
  const expected = meta.chunkIds.length * meta.dim * 4
  const raw = readFileSync(paths.data)
  if (raw.byteLength !== expected) return null
  const copy = new ArrayBuffer(raw.byteLength)
  new Uint8Array(copy).set(raw)
  return { dim: meta.dim, data: new Float32Array(copy) }
}

export async function buildVectorMatrix(chunks: readonly CorpusChunk[]): Promise<Float32Array> {
  const paths = vectorPaths()
  mkdirSync(paths.dir, { recursive: true })
  const ids = chunks.map((chunk) => chunk.chunkId)
  const existing = resumePoint(ids)
  let width = existing?.dim ?? 0
  let matrix = existing?.data ?? new Float32Array(0)
  const start = existing === null ? 0 : existing.done
  for (let offset = start; offset < chunks.length; offset += BATCH) {
    const batch = chunks.slice(offset, offset + BATCH)
    const embedded = await embedTexts(batch.map((chunk) => passageText(chunk.content)))
    if (width === 0) width = embedded.dim
    if (embedded.dim !== width) throw new Error(`向量维度不一致：${embedded.dim} / ${width}`)
    if (matrix.length === 0) matrix = new Float32Array(chunks.length * width)
    matrix.set(embedded.data, offset * width)
    const done = offset + batch.length
    if (offset === start || done % 400 < BATCH || done >= chunks.length) {
      flushMatrix(paths.meta, paths.data, ids, width, matrix, done)
      console.log(`[ask] 向量索引 ${Math.min(done, chunks.length)}/${chunks.length}`)
    }
  }
  flushMatrix(paths.meta, paths.data, ids, width, matrix, chunks.length)
  return matrix
}

export function searchVectors(
  matrix: Float32Array,
  dim: number,
  chunkIds: readonly number[],
  query: Float32Array,
  topK: number,
): { id: number; score: number }[] {
  if (dim === 0 || query.length !== dim) return []
  const hits: { id: number; score: number }[] = []
  for (let row = 0; row < chunkIds.length; row += 1) {
    let score = 0
    const base = row * dim
    for (let col = 0; col < dim; col += 1) score += (matrix[base + col] ?? 0) * (query[col] ?? 0)
    const id = chunkIds[row]
    if (id !== undefined && score > 0) hits.push({ id, score })
  }
  hits.sort((left, right) => right.score - left.score)
  return hits.slice(0, topK)
}

/**
 * 模型目录。容器里用 ASK_MODEL_DIR（compose 设为 /app/backend/models）。
 * 本机从 backend/ 跑时用 ./models，从仓库根跑时用 ./backend/models。
 * 目录下要有 Xenova/bge-small-zh-v1.5/{config,tokenizer,onnx}。
 */
function bundledModelDir(cwd: string = process.cwd()): string {
  const fromEnv = process.env['ASK_MODEL_DIR']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(fromEnv.trim())
  if (existsSync(resolve(cwd, 'prisma'))) return resolve(cwd, 'models')
  return resolve(cwd, 'backend', 'models')
}

let loadedModel = ''

async function getEmbedder(): Promise<EmbedCall> {
  const model = currentVectorModel()
  if (embedCall !== null && loadedModel === model) return embedCall
  embedCall = null
  const imported: unknown = await import('@huggingface/transformers')
  if (!isRecord(imported) || typeof imported['pipeline'] !== 'function') {
    throw new Error('向量模型模块未就绪')
  }
  useBundledModel(imported, model)
  const create = imported['pipeline'] as (
    task: 'feature-extraction',
    model: string,
    options: { readonly dtype: 'q8'; readonly local_files_only: true },
  ) => Promise<EmbedCall>
  embedCall = await create('feature-extraction', model, { dtype: 'q8', local_files_only: true })
  loadedModel = model
  return embedCall
}

function useBundledModel(imported: Record<string, unknown>, model: string): void {
  const env = imported['env']
  if (!isRecord(env)) throw new Error('向量模型环境未就绪')
  const root = bundledModelDir()
  const modelDir = resolve(root, model)
  for (const name of MODEL_FILES) {
    const file = resolve(modelDir, name)
    if (!existsSync(file)) throw new Error(`本地向量模型缺少 ${name}：${file}`)
  }
  env['localModelPath'] = root.endsWith('/') ? root : `${root}/`
  env['allowRemoteModels'] = false
  env['fetch'] = () => Promise.reject(new Error('向量模型只读本地文件，不会访问 huggingface.co'))
}

function readTensor(value: unknown, batch: number): { dim: number; data: Float32Array } {
  if (!isRecord(value) || !Array.isArray(value['dims'])) throw new Error('向量结果缺少维度')
  const dims = value['dims'].filter((item): item is number => typeof item === 'number')
  const dim = dims[dims.length - 1]
  if (dim === undefined || dim <= 0) throw new Error('向量维度无效')
  const raw = value['data']
  if (!(raw instanceof Float32Array) && !ArrayBuffer.isView(raw)) throw new Error('向量结果缺少数据')
  const data = raw instanceof Float32Array ? raw : new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  if (data.length !== batch * dim) throw new Error(`向量长度不符：${data.length} / ${batch * dim}`)
  return { dim, data }
}

export function readVectorIndexModel(): string | null {
  const paths = vectorPaths()
  if (!existsSync(paths.meta)) return null
  return readMeta(paths.meta)?.model ?? null
}

function readMeta(file: string): VectorMeta | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isRecord(parsed) || typeof parsed['model'] !== 'string' || typeof parsed['dim'] !== 'number') {
      return null
    }
    const ids = parsed['chunkIds']
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'number')) return null
    return { model: parsed['model'], dim: parsed['dim'], chunkIds: ids }
  } catch {
    return null
  }
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false
  return true
}

function resumePoint(ids: readonly number[]): { dim: number; done: number; data: Float32Array } | null {
  const paths = vectorPaths()
  const meta = existsSync(paths.meta) ? readMeta(paths.meta) : null
  if (meta === null || meta.model !== currentVectorModel() || !sameIds(meta.chunkIds, ids) || !existsSync(paths.data)) {
    return null
  }
  const raw = readFileSync(paths.data)
  const done = Math.floor(raw.byteLength / (meta.dim * 4))
  if (done <= 0 || done > ids.length) return null
  const data = new Float32Array(ids.length * meta.dim)
  const usable = done * meta.dim
  const copy = new ArrayBuffer(raw.byteLength)
  new Uint8Array(copy).set(raw)
  data.set(new Float32Array(copy).subarray(0, usable))
  return { dim: meta.dim, done, data }
}

function flushMatrix(
  metaPath: string,
  dataPath: string,
  ids: readonly number[],
  dim: number,
  matrix: Float32Array,
  done: number,
): void {
  writeFileSync(metaPath, JSON.stringify({ model: currentVectorModel(), dim, chunkIds: ids }))
  const bytes = Buffer.from(matrix.buffer, matrix.byteOffset, done * dim * 4)
  writeFileSync(dataPath, bytes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
