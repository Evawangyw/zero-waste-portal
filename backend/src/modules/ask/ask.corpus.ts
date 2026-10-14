// 问答语料：复现包里已审核资料的 Markdown 切片。书架索引不含正文，所以不从 KnowledgeIndex 读。
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from '../../weknora/index.js'

const DEFAULT_CORPUS =
  '/Users/evawang/Desktop/零废弃知识库-复现包/welfare-ai-deploy/server/data/app.db'

export interface CorpusChunk {
  readonly chunkId: number
  readonly documentId: number
  readonly title: string
  readonly organization: string
  readonly year: string
  readonly docType: string
  readonly content: string
}

async function openSqlite(filePath: string): Promise<{
  prepare(sql: string): { all(): ReadonlyArray<Record<string, unknown>> }
  close(): void
}> {
  try {
    const sqlite = await import('node:sqlite')
    return new sqlite.DatabaseSync(filePath, { readOnly: true })
  } catch {
    throw new Error('问答检索需要 Node.js 22 或更新版本（使用内置 node:sqlite）。')
  }
}

function readRow(row: Record<string, unknown>): CorpusChunk {
  return {
    chunkId: readInt(row['chunkId']),
    documentId: readInt(row['documentId']),
    title: readText(row['title']),
    organization: readText(row['organization']),
    year: readText(row['year']),
    docType: readText(row['docType']),
    content: readText(row['content']),
  }
}

function readInt(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return 0
}

function readText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return ''
}

export function resolveCorpusPath(): string {
  const env = loadEnvFile()
  const configured = env['ASK_CORPUS_DB']
  if (configured !== undefined && configured.trim() !== '') return configured.trim()
  return DEFAULT_CORPUS
}

export async function loadCorpus(filePath: string = resolveCorpusPath()): Promise<CorpusChunk[]> {
  if (!existsSync(filePath)) {
    throw new Error(`问答语料不存在：${filePath}。可设置 ASK_CORPUS_DB 指向含 chunks 的 app.db。`)
  }
  const db = await openSqlite(filePath)
  try {
    const rows = db
      .prepare(
        `SELECT c.id AS chunkId, c.document_id AS documentId, c.content,
                d.title AS title, d.organization AS organization, d.year AS year, d.doc_type AS docType
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE d.status = 'approved' AND length(trim(c.content)) > 0
         ORDER BY c.id`,
      )
      .all()
    return rows.map(readRow)
  } finally {
    db.close()
  }
}

export function vectorCacheDir(): string {
  if (existsSync(resolve(process.cwd(), 'prisma'))) return resolve(process.cwd(), 'data', 'ask-vectors')
  return resolve(process.cwd(), 'backend', 'data', 'ask-vectors')
}
