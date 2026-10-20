// 资料书架与问答共用复现包里的 documents。
// 只收「已通过、并且 Markdown 文件真的在磁盘上」的条目；原文按 source_key 的文件名在本机 PDF 目录里找。
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

import { loadEnvFile } from '../../weknora/index.js'
import { uploadsRoot } from './docs.upload.js'
import {
  META_KEY_DOC_TYPE,
  META_KEY_DOMAIN,
  META_KEY_LIBRARY,
  META_KEY_ORG,
  META_KEY_YEAR,
} from './docs.shelf.clean.js'

/** 复现包数据库；与问答检索同一份，可用 ASK_CORPUS_DB 改路径 */
const DEFAULT_CORPUS_DB =
  '/Users/evawang/Desktop/零废弃知识库-复现包/welfare-ai-deploy/server/data/app.db'

/** 按文件名找 PDF 的根目录，冒号分隔；默认扫本仓库 inputs 和复现包 */
const DEFAULT_PDF_ROOTS = [
  '/Users/evawang/Desktop/六尺巷/inputs',
  '/Users/evawang/Desktop/零废弃知识库-复现包',
]

const SUMMARY_KEY = '内容提要'

export interface CorpusDoc {
  readonly id: string
  readonly title: string
  readonly fileName: string
  readonly fileType: string
  readonly fileSize: number
  /** 本机原文绝对路径；找不到则为 null */
  readonly localPath: string | null
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
  /** 知识领域第一层：零废弃或化学品。空串表示表格里没对上。 */
  readonly library: string
  readonly summary: string
  /** 写入 knowledge_index.customMetadata 的四个书架字段，外加内容提要 */
  readonly customMetadata: Readonly<Record<string, string>>
}

let cached: Promise<readonly CorpusDoc[]> | null = null
const pinnedDocs = new Map<string, CorpusDoc>()

/** 刚入库、还没重新扫描原文目录的资料。重启后由文件名扫描接上。 */
export function rememberCorpusDoc(doc: CorpusDoc): void {
  pinnedDocs.set(doc.id, doc)
}

export function corpusDbPath(): string {
  loadEnvFile()
  const fromEnv = process.env['ASK_CORPUS_DB']
  return fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv.trim() : DEFAULT_CORPUS_DB
}

function pdfRoots(): readonly string[] {
  loadEnvFile()
  const fromEnv = process.env['ASK_PDF_ROOTS']
  const configured =
    fromEnv !== undefined && fromEnv.trim() !== ''
      ? fromEnv
          .split(':')
          .map((part) => part.trim())
          .filter((part) => part !== '')
      : [...DEFAULT_PDF_ROOTS]
  return [...configured, uploadsRoot()]
}

/** 文件名（含扩展名）-> 绝对路径。同名只留先扫到的那份。 */
function indexFilesByName(roots: readonly string[]): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name === '.git' || name.startsWith('.')) continue
      const full = join(dir, name)
      let info
      try {
        info = statSync(full)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        walk(full)
        continue
      }
      if (!found.has(name)) found.set(name, full)
    }
  }
  for (const root of roots) walk(root)
  return found
}

function readText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return ''
}

function readInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value)
  return 0
}

function readYear(value: unknown): string {
  const asInt = readInt(value)
  if (asInt > 0) return String(Math.trunc(asInt))
  const text = readText(value).trim()
  return /^\d{4}$/.test(text) ? text : ''
}

function serverRootOf(dbFile: string): string {
  return resolve(dbFile, '..', '..')
}

async function openSqlite(filePath: string): Promise<{
  prepare(sql: string): { all(): ReadonlyArray<Record<string, unknown>> }
  close(): void
}> {
  try {
    const sqlite = await import('node:sqlite')
    return new sqlite.DatabaseSync(filePath, { readOnly: true })
  } catch {
    throw new Error('读取资料库需要 Node.js 22 或更新版本（使用内置 node:sqlite）。')
  }
}

export async function ensureDocumentsLibrary(dbFile: string): Promise<void> {
  const sqlite = await import('node:sqlite')
  let hasLibrary = false
  try {
    const readOnly = new sqlite.DatabaseSync(dbFile, { readOnly: true })
    try {
      const columns = readOnly.prepare('PRAGMA table_info(documents)').all() as readonly { name?: string }[]
      hasLibrary = columns.some((column) => column.name === 'library')
    } finally {
      readOnly.close()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`打不开语料库 ${dbFile}：${message}`)
  }
  if (hasLibrary) return
  const db = new sqlite.DatabaseSync(dbFile)
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN library TEXT NOT NULL DEFAULT ''`)
  } finally {
    db.close()
  }
}

async function readApprovedRows(dbFile: string): Promise<readonly Record<string, unknown>[]> {
  await ensureDocumentsLibrary(dbFile)
  const db = await openSqlite(dbFile)
  try {
    return db
      .prepare(
        `SELECT id, title, source_key, md_path, year, organization, doc_type, topic, library, summary
         FROM documents
         WHERE status = 'approved'
         ORDER BY id`,
      )
      .all()
  } finally {
    db.close()
  }
}

function toCorpusDoc(
  row: Record<string, unknown>,
  serverRoot: string,
  files: ReadonlyMap<string, string>,
): CorpusDoc | null {
  const mdRelative = readText(row['md_path']).trim()
  if (mdRelative === '') return null
  const mdAbsolute = resolve(serverRoot, mdRelative)
  if (!existsSync(mdAbsolute)) return null

  const sourceKey = readText(row['source_key']).trim()
  const fileName = sourceKey === '' ? `doc-${readInt(row['id'])}` : basename(sourceKey)
  const ext = extname(fileName).replace(/^\./, '').toLowerCase()
  const localPath = files.get(fileName) ?? null
  let fileSize = 0
  if (localPath !== null) {
    try {
      fileSize = statSync(localPath).size
    } catch {
      fileSize = 0
    }
  }
  const year = readYear(row['year'])
  const org = readText(row['organization']).trim()
  const docType = readText(row['doc_type']).trim()
  const topic = readText(row['topic']).trim()
  const topics = topic === '' ? [] : [topic]
  const library = readText(row['library']).trim()
  const summary = readText(row['summary']).trim()
  const customMetadata: Record<string, string> = {}
  if (year !== '') customMetadata[META_KEY_YEAR] = year
  if (docType !== '') customMetadata[META_KEY_DOC_TYPE] = docType
  if (topic !== '') customMetadata[META_KEY_DOMAIN] = topic
  if (library !== '') customMetadata[META_KEY_LIBRARY] = library
  if (org !== '') customMetadata[META_KEY_ORG] = org
  if (summary !== '') customMetadata[SUMMARY_KEY] = summary
  const title = readText(row['title']).trim() || fileName
  return {
    id: String(readInt(row['id'])),
    title,
    fileName,
    fileType: ext,
    fileSize,
    localPath,
    year,
    org,
    docType,
    topics,
    library,
    summary,
    customMetadata,
  }
}

/** 有 Markdown 的已通过文档。结果缓存在进程里。 */
export function loadCorpusDocs(): Promise<readonly CorpusDoc[]> {
  if (cached === null) {
    cached = (async () => {
      const dbFile = corpusDbPath()
      const rows = await readApprovedRows(dbFile)
      const files = indexFilesByName(pdfRoots())
      const serverRoot = serverRootOf(dbFile)
      const docs: CorpusDoc[] = []
      for (const row of rows) {
        const doc = toCorpusDoc(row, serverRoot, files)
        if (doc !== null) docs.push(doc)
      }
      return docs
    })()
  }
  return cached
}

export async function findCorpusDoc(id: string): Promise<CorpusDoc | null> {
  const pinned = pinnedDocs.get(id)
  if (pinned !== undefined) return pinned
  const docs = await loadCorpusDocs()
  return docs.find((doc) => doc.id === id) ?? null
}

/** 语料编号对应的本机原文。null 表示这不是语料编号（仍走原来的引擎）。 */
export async function locateCorpusFile(
  id: string,
): Promise<{ readonly kind: 'file'; readonly path: string; readonly size: number } | { readonly kind: 'missing' } | null> {
  const doc = await findCorpusDoc(id)
  if (doc === null) return null
  if (doc.localPath === null) return { kind: 'missing' }
  return { kind: 'file', path: doc.localPath, size: doc.fileSize }
}

export const CORPUS_SUMMARY_KEY = SUMMARY_KEY
