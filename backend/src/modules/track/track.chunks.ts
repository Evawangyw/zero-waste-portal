// 模块边界：track（管理统计 · 切片窗口）
//
// 契约：
//   GET /api/admin/chunks/documents -> 200 ChunkDocumentsResponse
//   GET /api/admin/chunks?documentId=&page=&pageSize= -> 200 ChunkPageResponse
//   守卫与 /api/admin/stats/summary 相同。
//   只读问答语料里的 chunks，不改检索、不写库。
import type { Request, Response } from 'express'
import { listCorpusChunks, listCorpusDocuments } from '../ask/ask.corpus.js'
import type { ChunkErrorResponse, ChunkPageResponse } from './track.types.js'

const DEFAULT_PAGE_SIZE = 8
const MAX_PAGE_SIZE = 20

export async function handleChunkDocuments(_req: Request, res: Response): Promise<void> {
  try {
    const documents = await listCorpusDocuments()
    res.status(200).json({ success: true, documents })
  } catch (err) {
    respondChunkError(res, 503, 'unavailable', corpusMessage(err))
  }
}

export async function handleChunkPage(req: Request, res: Response): Promise<void> {
  const documentId = readDocumentId(req.query['documentId'])
  if (documentId === null) {
    respondChunkError(res, 400, 'bad_request', '需要资料编号 documentId')
    return
  }
  const page = readPositiveInt(req.query['page'], 1)
  const pageSize = Math.min(readPositiveInt(req.query['pageSize'], DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  try {
    const pageResult = await listCorpusChunks(documentId, page, pageSize)
    if (pageResult === null) {
      respondChunkError(res, 404, 'not_found', '没有这份资料')
      return
    }
    const body: ChunkPageResponse = {
      success: true,
      documentId,
      title: pageResult.title,
      total: pageResult.total,
      page,
      pageSize,
      items: pageResult.items,
    }
    res.status(200).json(body)
  } catch (err) {
    respondChunkError(res, 503, 'unavailable', corpusMessage(err))
  }
}

function readDocumentId(value: unknown): number | null {
  const text = Array.isArray(value) ? value[0] : value
  if (typeof text !== 'string' || !/^\d{1,12}$/u.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) ? id : null
}

function readPositiveInt(value: unknown, fallback: number): number {
  const text = Array.isArray(value) ? value[0] : value
  if (typeof text !== 'string' || !/^\d{1,6}$/u.test(text)) return fallback
  const parsed = Number(text)
  return parsed >= 1 ? parsed : fallback
}

function corpusMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err)
  console.error(`[track] 读取切片失败：${detail}`)
  return '切片库暂时读不到'
}

function respondChunkError(
  res: Response,
  status: number,
  kind: ChunkErrorResponse['error']['kind'],
  message: string,
): void {
  const body: ChunkErrorResponse = { success: false, error: { kind, message } }
  res.status(status).json(body)
}
