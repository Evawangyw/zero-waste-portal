// SoMark 转出的 Markdown 写入本仓库语料库，并换成书架上的语料编号。
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

import { rememberIngestedChunks } from '../ask/ask.retrieve.js'
import type { CorpusChunk } from '../ask/ask.corpus.js'
import { getPrisma } from '../../db/prisma.js'
import { corpusDbPath, ensureDocumentsLibrary, rememberCorpusDoc, type CorpusDoc } from './docs.corpus.js'
import { CORPUS_KNOWLEDGE_BASE_ID } from './docs.corpus.sync.js'
import {
  META_KEY_DOC_TYPE,
  META_KEY_DOMAIN,
  META_KEY_LIBRARY,
  META_KEY_ORG,
  META_KEY_YEAR,
} from './docs.shelf.clean.js'
import type { SomarkConvertInput, SomarkMarkdown } from './docs.somark.js'

export interface IngestedSomarkDoc {
  readonly docId: number
  readonly chunks: number
}

export async function ingestSomarkMarkdown(
  input: SomarkConvertInput,
  converted: SomarkMarkdown,
): Promise<IngestedSomarkDoc> {
  const dbFile = corpusDbPath()
  const serverRoot = resolve(dbFile, '..', '..')
  const mdName = `md-${createHash('sha1').update(input.documentId).digest('hex').slice(0, 16)}.md`
  const mdDir = join(serverRoot, 'storage', 'markdown')
  mkdirSync(mdDir, { recursive: true })
  writeFileSync(join(mdDir, mdName), converted.markdown)

  const topic = input.topic === '' ? '其他' : input.topic
  const library = input.library === '零废弃' || input.library === '化学品' ? input.library : ''
  const year = /^\d{4}$/u.test(input.year) ? Number(input.year) : null
  const saved = await insertCorpus(dbFile, {
    title: input.title,
    organization: input.org === '' ? null : input.org,
    year,
    docType: input.docType,
    topic,
    library,
    mdPath: `storage/markdown/${mdName}`,
    markdown: converted.markdown,
    sourceKey: input.fileName,
  })

  const shelfId = String(saved.docId)
  const custom: Record<string, string> = {}
  if (year !== null) custom[META_KEY_YEAR] = String(year)
  if (input.org !== '') custom[META_KEY_ORG] = input.org
  if (input.docType !== '') custom[META_KEY_DOC_TYPE] = input.docType
  if (topic !== '') custom[META_KEY_DOMAIN] = topic
  if (library !== '') custom[META_KEY_LIBRARY] = library
  const doc: CorpusDoc = {
    id: shelfId,
    title: input.title,
    fileName: input.fileName,
    fileType: extname(input.fileName).replace(/^\./, '').toLowerCase(),
    fileSize: input.fileSize,
    localPath: input.filePath,
    year: year === null ? '' : String(year),
    org: input.org,
    docType: input.docType,
    topics: [topic],
    library,
    summary: '',
    customMetadata: custom,
  }
  rememberCorpusDoc(doc)

  const prisma = getPrisma()
  const fileSize = input.fileSize > 2_147_483_647 ? 2_147_483_647 : input.fileSize
  const data = {
    knowledgeBaseId: CORPUS_KNOWLEDGE_BASE_ID,
    title: input.title,
    fileName: input.fileName,
    readableTitle: input.title,
    fileType: doc.fileType,
    fileSize,
    customMetadata: JSON.stringify(custom),
    tags: '[]',
    year: doc.year,
    org: input.org,
    docType: input.docType,
    topics: JSON.stringify([topic]),
    library,
    sourceUpdatedAt: null,
    syncedAt: new Date(),
  }
  await prisma.knowledgeIndex.deleteMany({ where: { knowledgeId: input.documentId } })
  await prisma.knowledgeIndex.upsert({
    where: { knowledgeId: shelfId },
    create: { knowledgeId: shelfId, ...data },
    update: data,
  })
  await rememberIngestedChunks(saved.chunks)
  return { docId: saved.docId, chunks: saved.chunks.length }
}

interface CorpusInsert {
  readonly title: string
  readonly organization: string | null
  readonly year: number | null
  readonly docType: string
  readonly topic: string
  readonly library: string
  readonly mdPath: string
  readonly markdown: string
  readonly sourceKey: string
}

async function insertCorpus(
  dbFile: string,
  row: CorpusInsert,
): Promise<{ docId: number; chunks: CorpusChunk[] }> {
  const sqlite = await import('node:sqlite')
  await ensureDocumentsLibrary(dbFile)
  const db = new sqlite.DatabaseSync(dbFile)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    const info = db
      .prepare(
        `INSERT INTO documents (title, organization, year, doc_type, topic, library, md_path, source_text, source_key, is_sample, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'approved')`,
      )
      .run(
        row.title,
        row.organization,
        row.year,
        row.docType === '' ? null : row.docType,
        row.topic,
        row.library,
        row.mdPath,
        row.markdown,
        row.sourceKey,
      )
    const docId = Number(info.lastInsertRowid)
    const insertChunk = db.prepare('INSERT INTO chunks (document_id, chunk_index, content) VALUES (?, ?, ?)')
    const pieces = splitIntoChunks(row.markdown)
    const chunks: CorpusChunk[] = []
    db.exec('BEGIN')
    try {
      for (let index = 0; index < pieces.length; index += 1) {
        const content = pieces[index] ?? ''
        const inserted = insertChunk.run(docId, index, content)
        chunks.push({
          chunkId: Number(inserted.lastInsertRowid),
          documentId: docId,
          title: row.title,
          organization: row.organization ?? '',
          year: row.year === null ? '' : String(row.year),
          docType: row.docType,
          content,
        })
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { docId, chunks }
  } finally {
    db.close()
  }
}

function splitIntoChunks(text: string, size = 350, overlap = 60): string[] {
  const paragraphs = text
    .split(/\n+/u)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const chunks: string[] = []
  let buffer = ''
  const flush = (value: string): void => {
    const trimmed = value.trim()
    if (trimmed !== '') chunks.push(trimmed)
  }
  for (const para of paragraphs) {
    if (para.length <= size) {
      if (buffer !== '' && buffer.length + 1 + para.length > size) {
        flush(buffer)
        buffer = para
      } else {
        buffer = buffer === '' ? para : `${buffer}\n${para}`
      }
      continue
    }
    if (buffer !== '') {
      flush(buffer)
      buffer = ''
    }
    const sentences = para.match(/[^。！？；\n]*[。！？；]?/gu)?.filter((part) => part !== '') ?? [para]
    let current = ''
    for (const sentence of sentences) {
      if (current.length + sentence.length > size) {
        flush(current)
        current = (overlap > 0 ? current.slice(-overlap) : '') + sentence
      } else {
        current += sentence
      }
    }
    if (current.trim() !== '') buffer = current
  }
  flush(buffer)
  return chunks
}
