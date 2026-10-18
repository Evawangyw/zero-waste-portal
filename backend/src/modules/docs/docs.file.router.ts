// 模块边界：docs（文件层 · 路由）
// 契约：
//   GET /api/docs/:id            -> 200 DocDetailResponse | 401 | 404 | 400  ← requireAuth
//   GET /api/docs/:id/preview    -> 200 流 | 200 PreviewEnvelope(unsupported/tooLarge) | 401 | 404
//   GET /api/docs/:id/download   -> 200 流(attachment, 重命名) | 401 | 404  ← requireAuth 保护
//
// 实现要点：
//  - 三条路由都挂在 docs 模块自己的 fileRouter 上（不动 auth/shelf 已验收代码）
//  - 下载用 T02 导出的 requireAuth + getAuthContext 解 JWT，**只 import 不修改**
//  - 预览/下载只读本机原文，不回源引擎；客户端断开时停掉文件流
//  - 下载日志在**开流之前**写，保证「已授权的下载尝试」一定留痕（写日志失败不阻断下载）
import { Router } from 'express'
import type { Request, Response } from 'express'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { getAuthContext, requireAuth } from '../auth/index.js'
import type { AuthLocals, AuthRequest } from '../auth/index.js'
import { getPrisma } from '../../db/prisma.js'
import { locateCorpusFile } from './docs.corpus.js'
import { locateAdminUploadFile } from './docs.upload.js'
import { buildContentDisposition, buildDownloadFileName } from './docs.file.name.js'
import {
  decidePreview,
  resolveDocDetail,
  resolveDocForDownload,
  writeDownloadLog,
} from './docs.file.service.js'
import type {
  DocDetailResponse,
  DocFileErrorKind,
  DocFileErrorResponse,
  PreviewEnvelope,
} from './docs.file.types.js'

export const fileRouter: Router = Router()

// ------------------------------------------------------------------ 详情

fileRouter.get('/api/docs/:id', requireAuth, (req: Request, res: Response) => {
  void handleDetail(req, res)
})

async function handleDetail(req: Request, res: Response): Promise<void> {
  const id = readId(req.params['id'])
  if (id === null) {
    respondError(res, 400, 'bad_request', '资料 ID 不合法')
    return
  }
  try {
    const detail = await resolveDocDetail(id)
    if (detail === null) {
      respondError(res, 404, 'not_found', '资料不存在或尚未收录')
      return
    }
    respondJson<DocDetailResponse>(res, 200, detail)
  } catch (err) {
    respondInternal(res, '查询资料详情失败', err)
  }
}

// ------------------------------------------------------------------ 预览

fileRouter.get('/api/docs/:id/preview', requireAuth, (req: Request, res: Response) => {
  void handlePreview(req, res)
})

async function handlePreview(req: Request, res: Response): Promise<void> {
  const id = readId(req.params['id'])
  if (id === null) {
    respondError(res, 400, 'bad_request', '资料 ID 不合法')
    return
  }

  let detail: DocDetailResponse | null
  try {
    detail = await resolveDocDetail(id)
  } catch (err) {
    respondInternal(res, '解析预览信息失败', err)
    return
  }
  if (detail === null) {
    respondError(res, 404, 'not_found', '资料不存在或尚未收录')
    return
  }

  // 判据来自索引（file_type / file_size），不打引擎就能决定
  const decision = decidePreview(detail.doc.fileType, detail.doc.fileSize)
  if (!decision.streamable) {
    const envelope: PreviewEnvelope = {
      success: true,
      preview: decision,
      id: detail.doc.id,
      title: detail.doc.title,
      fileType: detail.doc.fileType,
      fileSize: detail.doc.fileSize,
      downloadUrl: `/api/docs/${encodeURIComponent(detail.doc.id)}/download`,
    }
    respondJson<PreviewEnvelope>(res, 200, envelope)
    return
  }

  const previewName =
    detail.doc.fileName === '' ? `${detail.doc.id}.${detail.doc.fileType}` : detail.doc.fileName
  const previewOptions: PipeBinaryOptions = {
    disposition: 'inline',
    contentType: decision.contentType,
    fileName: previewName,
    contentLength: decision.sizeBytes,
    extraHeaders: {
      'X-Preview-Max-Bytes': String(decision.maxBytes),
      'X-Preview-Too-Large': 'false',
    },
  }

  const located = await resolveLocalFile(id)
  if (located?.kind !== 'file') {
    const envelope: PreviewEnvelope = {
      success: true,
      preview: {
        ...decision,
        streamable: false,
        unsupported: true,
        reason: '本机没有这份原文，暂时不能在线预览',
      },
      id: detail.doc.id,
      title: detail.doc.title,
      fileType: detail.doc.fileType,
      fileSize: detail.doc.fileSize,
      downloadUrl: `/api/docs/${encodeURIComponent(detail.doc.id)}/download`,
    }
    respondJson<PreviewEnvelope>(res, 200, envelope)
    return
  }

  await pipeLocalFile(res, located.path, { ...previewOptions, contentLength: located.size })
}

// ------------------------------------------------------------------ 下载

// requireAuth 挂在路由上：未登录 401 由 auth 模块给出（不重复实现鉴权逻辑）
fileRouter.get('/api/docs/:id/download', requireAuth, (req: AuthRequest, res: AuthResponse) => {
  void handleDownload(req, res)
})

/** 守卫之后的处理器：res.locals 已类型化为 AuthLocals（由 T02 声明，本卡不改） */
type AuthResponse = Response<unknown, AuthLocals>

async function handleDownload(req: AuthRequest, res: AuthResponse): Promise<void> {
  const id = readId(req.params['id'])
  if (id === null) {
    respondError(res, 400, 'bad_request', '资料 ID 不合法')
    return
  }

  // 守卫没生效时不该走到这里；真发生就是接线漏了，明确报 401 而不是匿名放行
  const auth = getAuthContext(res)
  if (auth === null) {
    respondError(res, 401, 'unauthorized', '请先登录后再下载')
    return
  }

  let resolved: Awaited<ReturnType<typeof resolveDocForDownload>>
  try {
    resolved = await resolveDocForDownload(id)
  } catch (err) {
    respondInternal(res, '解析下载地址失败', err)
    return
  }
  if (resolved === null) {
    respondError(res, 404, 'not_found', '资料不存在或尚未收录')
    return
  }

  const fileName = buildDownloadFileName(
    resolved.metadata.year,
    resolved.metadata.org,
    resolved.title,
    resolved.fileType,
  )

  const located = await resolveLocalFile(id)
  if (located?.kind !== 'file') {
    respondError(res, 404, 'not_found', '本机没有这份原文')
    return
  }

  // 先写下载日志再开流：已授权的下载尝试必须留痕（看板下载排行）
  await writeDownloadLog(getPrisma(), auth.userId, resolved.id, fileName)

  const downloadOptions: PipeBinaryOptions = {
    disposition: 'attachment',
    contentType: 'application/octet-stream',
    fileName,
    contentLength: located?.kind === 'file' ? located.size : resolved.fileSize,
    extraHeaders: {
      'X-Download-File-Name': encodeURIComponent(fileName),
      'X-Download-Source': located?.kind === 'file' ? 'corpus' : resolved.source,
    },
  }
  await pipeLocalFile(res, located.path, downloadOptions)
}

// ------------------------------------------------------------------ 本机原文

/** 管理员上传优先，其次是语料原文。找不到就没有文件，不再去问引擎。 */
async function resolveLocalFile(
  id: string,
): Promise<
  { readonly kind: 'file'; readonly path: string; readonly size: number } | { readonly kind: 'missing' } | null
> {
  const uploaded = await locateAdminUploadFile(id)
  if (uploaded !== null) return uploaded
  return locateCorpusFile(id)
}

/** 语料 PDF 直接从磁盘流出，不经过 WeKnora，也不把整份文件读进内存。 */
async function pipeLocalFile(res: Response, filePath: string, options: PipeBinaryOptions): Promise<void> {
  const stream = createReadStream(filePath)
  const onClientClose = (): void => {
    stream.destroy()
  }
  res.on('close', onClientClose)
  try {
    res.status(200)
    res.setHeader('Content-Type', options.contentType)
    res.setHeader('Content-Disposition', buildContentDisposition(options.disposition, options.fileName))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (options.contentLength > 0) {
      res.setHeader('Content-Length', String(options.contentLength))
    }
    for (const [key, value] of Object.entries(options.extraHeaders ?? {})) {
      res.setHeader(key, value)
    }
    await pipeline(stream, res)
  } catch (err) {
    if (res.headersSent) {
      res.destroy(err instanceof Error ? err : new Error(String(err)))
      return
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[docs.file] 本机原文读取失败：${detail}`)
    respondError(res, 502, 'upstream_unavailable', '原文暂时读不出来，请稍后重试')
  } finally {
    res.off('close', onClientClose)
  }
}

// ------------------------------------------------------------------ 本机文件头

interface PipeBinaryOptions {
  readonly disposition: 'attachment' | 'inline'
  readonly contentType: string
  readonly fileName: string
  /** 已知字节数；0/未知则不设 Content-Length（浏览器按 chunked 收） */
  readonly contentLength: number
  readonly extraHeaders?: Readonly<Record<string, string>> | undefined
}

// ------------------------------------------------------------------ 工具

/**
 * 资料 ID：WeKnora 的 UUID，或复现包 documents.id（纯数字）。
 * 不收路径分隔符，避免把 ../ 拼进文件路径。
 */
const DOC_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{1,12}|upload-[0-9a-f]{16})$/i

function readId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return DOC_ID_RE.test(trimmed) ? trimmed : null
}

function respondJson<T>(res: Response, status: number, body: T): void {
  res.status(status).json(body)
}

function respondError(
  res: Response,
  status: number,
  kind: DocFileErrorKind,
  message: string,
): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  const body: DocFileErrorResponse = {
    success: false,
    error: { kind, message },
  }
  res.status(status).json(body)
}

function respondInternal(res: Response, message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err)
  console.error(`[docs.file] ${message}：${detail}`)
  respondError(res, 500, 'internal', `${message}（详见服务端日志）`)
}
