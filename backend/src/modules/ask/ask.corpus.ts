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
  prepare(sql: string): {
    all(...params: readonly (string | number | bigint | null)[]): ReadonlyArray<Record<string, unknown>>
  }
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

export interface CorpusDocumentSummary {
  readonly documentId: number
  readonly title: string
  readonly organization: string
  readonly year: string
  readonly chunkCount: number
}

export interface CorpusChunkPage {
  readonly title: string
  readonly total: number
  readonly items: readonly { readonly chunkId: number; readonly chunkIndex: number; readonly content: string }[]
}

/** 已审核资料和各自的切片数。给管理统计的切片窗口用，不把正文读出来。 */
export async function listCorpusDocuments(
  filePath: string = resolveCorpusPath(),
): Promise<CorpusDocumentSummary[]> {
  const db = await openSqlite(filePath)
  try {
    return db
      .prepare(
        `SELECT d.id AS documentId, d.title AS title, d.organization AS organization,
                d.year AS year, COUNT(c.id) AS chunkCount
         FROM documents d
         LEFT JOIN chunks c ON c.document_id = d.id
         WHERE d.status = 'approved'
         GROUP BY d.id
         ORDER BY d.id`,
      )
      .all()
      .map((row) => ({
        documentId: readInt(row['documentId']),
        title: readText(row['title']),
        organization: readText(row['organization']),
        year: readText(row['year']),
        chunkCount: readInt(row['chunkCount']),
      }))
  } finally {
    db.close()
  }
}

/** 某一份资料的切片页。资料不存在时返回 null。 */
export async function listCorpusChunks(
  documentId: number,
  page: number,
  pageSize: number,
  filePath: string = resolveCorpusPath(),
): Promise<CorpusChunkPage | null> {
  const db = await openSqlite(filePath)
  try {
    const doc = db.prepare(`SELECT title FROM documents WHERE id = ? AND status = 'approved'`).all(documentId)[0]
    if (doc === undefined) return null
    const total = readInt(db.prepare(`SELECT COUNT(*) AS n FROM chunks WHERE document_id = ?`).all(documentId)[0]?.['n'])
    const offset = Math.max(page - 1, 0) * pageSize
    const items = db
      .prepare(
        `SELECT id AS chunkId, content FROM chunks
         WHERE document_id = ? ORDER BY id LIMIT ? OFFSET ?`,
      )
      .all(documentId, pageSize, offset)
      .map((row, index) => ({
        chunkId: readInt(row['chunkId']),
        chunkIndex: offset + index,
        content: readText(row['content']),
      }))
    return { title: readText(doc['title']), total, items }
  } finally {
    db.close()
  }
}

export function vectorCacheDir(): string {
  if (existsSync(resolve(process.cwd(), 'prisma'))) return resolve(process.cwd(), 'data', 'ask-vectors')
  return resolve(process.cwd(), 'backend', 'data', 'ask-vectors')
}

/** 管理统计用的切片规模。读不到语料时 available=false，不把整份看板拖垮。 */
export interface CorpusIndexStatus {
  readonly available: boolean
  readonly documentsTotal: number
  readonly documentsApproved: number
  readonly chunks: number
  readonly indexedDocuments: number
  readonly avgChunksPerDoc: number
  readonly docsWithoutChunks: {
    readonly count: number
    readonly samples: readonly string[]
  }
}

const EMPTY_INDEX: CorpusIndexStatus = {
  available: false,
  documentsTotal: 0,
  documentsApproved: 0,
  chunks: 0,
  indexedDocuments: 0,
  avgChunksPerDoc: 0,
  docsWithoutChunks: { count: 0, samples: [] },
}

export async function loadCorpusIndexStatus(
  filePath: string = resolveCorpusPath(),
): Promise<CorpusIndexStatus> {
  if (!existsSync(filePath)) return EMPTY_INDEX
  try {
    const db = await openSqlite(filePath)
    try {
      const documentsTotal = scalar(db, 'SELECT COUNT(*) AS n FROM documents')
      const documentsApproved = scalar(
        db,
        "SELECT COUNT(*) AS n FROM documents WHERE status = 'approved'",
      )
      const chunks = scalar(db, 'SELECT COUNT(*) AS n FROM chunks')
      const indexedDocuments = scalar(
        db,
        'SELECT COUNT(DISTINCT document_id) AS n FROM chunks',
      )
      const missing = db
        .prepare(
          `SELECT d.title AS title FROM documents d
           LEFT JOIN chunks c ON c.document_id = d.id
           WHERE d.status = 'approved'
           GROUP BY d.id
           HAVING COUNT(c.id) = 0
           ORDER BY d.id
           LIMIT 5`,
        )
        .all()
      const missingCount = scalar(
        db,
        `SELECT COUNT(*) AS n FROM (
           SELECT d.id FROM documents d
           LEFT JOIN chunks c ON c.document_id = d.id
           WHERE d.status = 'approved'
           GROUP BY d.id
           HAVING COUNT(c.id) = 0
         )`,
      )
      return {
        available: true,
        documentsTotal,
        documentsApproved,
        chunks,
        indexedDocuments,
        avgChunksPerDoc:
          documentsApproved > 0 ? Math.round((chunks / documentsApproved) * 10) / 10 : 0,
        docsWithoutChunks: {
          count: missingCount,
          samples: missing.map((row) => readText(row['title'])).filter((title) => title !== ''),
        },
      }
    } finally {
      db.close()
    }
  } catch {
    return EMPTY_INDEX
  }
}

function scalar(
  db: { prepare(sql: string): { all(): ReadonlyArray<Record<string, unknown>> } },
  sql: string,
): number {
  const row = db.prepare(sql).all()[0]
  return readInt(row?.['n'])
}
