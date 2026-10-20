// 把资料书架换成复现包里「有 Markdown」的文档。
// knowledgeId 用 documents.id 的十进制字符串，和问答来源卡片的 docId 相同。
import type { PrismaClient } from '@prisma/client'

import { getPrisma } from '../../db/prisma.js'
import { loadCorpusDocs, type CorpusDoc } from './docs.corpus.js'
import { parseShelfMetadata } from './docs.shelf.clean.js'

export const CORPUS_KNOWLEDGE_BASE_ID = 'markdown-corpus'

/** SQLite INTEGER 主键上限；更大的文件体积按这个值存，避免 Prisma Int 溢出 */
const MAX_FILE_SIZE = 2_147_483_647

export interface CorpusShelfSyncResult {
  readonly total: number
  readonly withFile: number
  readonly missingFile: number
  readonly removed: number
}

export async function syncCorpusShelf(
  prisma: PrismaClient = getPrisma(),
): Promise<CorpusShelfSyncResult> {
  const docs = await loadCorpusDocs()
  if (docs.length === 0) {
    throw new Error('语料里没有带 Markdown 的已通过文档，拒绝清空书架。')
  }

  const now = new Date()
  const chunkSize = 40
  for (let offset = 0; offset < docs.length; offset += chunkSize) {
    const slice = docs.slice(offset, offset + chunkSize)
    await prisma.$transaction(slice.map((doc) => prisma.knowledgeIndex.upsert(toUpsert(doc, now))))
  }

  const removed = await prisma.knowledgeIndex.deleteMany({
    where: {
      knowledgeBaseId: CORPUS_KNOWLEDGE_BASE_ID,
      knowledgeId: { notIn: docs.map((doc) => doc.id) },
    },
  })

  const withFile = docs.filter((doc) => doc.localPath !== null).length
  return {
    total: docs.length,
    withFile,
    missingFile: docs.length - withFile,
    removed: removed.count,
  }
}

function toUpsert(doc: CorpusDoc, syncedAt: Date) {
  const meta = parseShelfMetadata(doc.customMetadata)
  const fileSize = doc.fileSize > MAX_FILE_SIZE ? MAX_FILE_SIZE : Math.max(0, Math.trunc(doc.fileSize))
  const data = {
    knowledgeBaseId: CORPUS_KNOWLEDGE_BASE_ID,
    title: doc.title,
    fileName: doc.fileName,
    readableTitle: doc.title,
    fileType: doc.fileType,
    fileSize,
    customMetadata: JSON.stringify(doc.customMetadata),
    tags: '[]',
    year: meta.year,
    org: meta.org,
    docType: meta.docType,
    topics: JSON.stringify(meta.topics),
    library: doc.library,
    sourceUpdatedAt: null,
    syncedAt,
  }
  return {
    where: { knowledgeId: doc.id },
    create: { knowledgeId: doc.id, ...data },
    update: data,
  }
}
