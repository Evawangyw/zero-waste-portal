// 模块边界：docs（文件层 · 路由）
// 契约：
//   GET /api/docs/:id            -> 200 DocDetailResponse | 401 | 404 | 400  ← requireAuth
//   GET /api/docs/:id/preview    -> 200 流 | 200 PreviewEnvelope(unsupported/tooLarge) | 401 | 404
//   GET /api/docs/:id/preview-ticket -> 200 PreviewTicketResponse | 200 PreviewEnvelope | 401 | 404
//   GET /api/docs/:id/preview-named/:fileName?ticket= -> 200 流 | 401 | 404
//   GET /api/docs/:id/download   -> 200 流(attachment, 重命名) | 401 | 404  ← requireAuth 保护
//
// 实现要点：
//  - 预览/下载路由都挂在 docs 模块自己的 fileRouter 上（不动 auth/shelf 已验收代码）
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
import { isDocListed } from './docs.listing.js'
import { locateAdminUploadFile } from './docs.upload.js'
import { buildContentDisposition, buildDownloadFileName } from './docs.file.name.js'
import {
  decidePreview,
  resolveDocDetail,
  resolveDocForDownload,
  writeDownloadLog,
} from './docs.file.service.js'
import {
  buildNamedPreviewUrl,
  issuePreviewTicket,
  verifyPreviewTicket,
} from './docs.preview.ticket.js'
import type {
  DocDetailResponse,
  DocFileErrorKind,
  DocFileErrorResponse,
  PreviewDecision,
  PreviewEnvelope,
  PreviewTicketResponse,
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
  if (await refuseUnlisted(id, res)) return
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

fileRouter.get('/api/docs/:id/preview-ticket', requireAuth, (req: Request, res: Response) => {
  void handlePreviewTicket(req, res)
})

// :fileName 只出现在地址里，给 PDF 工具栏当显示名；找文件仍只认 :id + ticket
fileRouter.get('/api/docs/:id/preview-named/:fileName', (req: Request, res: Response) => {
  void handlePreviewNamed(req, res)
})

async function handlePreview(req: Request, res: Response): Promise<void> {
  const id = readId(req.params['id'])
  if (id === null) {
    respondError(res, 400, 'bad_request', '资料 ID 不合法')
    return
  }
  if (await refuseUnlisted(id, res)) return
  const opened = await openPreview(id)
  await sendPreview(res, opened, req)
}

async function handlePreviewTicket(req: Request, res: Response): Promise<void> {
  const id = readId(req.params['id'])
  if (id === null) {
    respondError(res, 400, 'bad_request', '资料 ID 不合法')
    return
  }
  if (await refuseUnlisted(id, res)) return
  const opened = await openPreview(id)
  if (opened.kind !== 'file') {
    await sendPreview(res, opened)
    return
  }
  let listed: boolean | null
  try {
    listed = await isDocListed(id)
  } catch (err) {
    respondInternal(res, '查询资料状态失败', err)
    return
  }
  const ticket = issuePreviewTicket(id, listed === false)
  const body: PreviewTicketResponse = {
    success: true,
    ticket,
    fileName: opened.fileName,
    url: buildNamedPreviewUrl(id, opened.fileName, ticket),
  }
  respondJson<PreviewTicketResponse>(res, 200, body)
}

async function handlePreviewNamed(req: Request, res: Response): Promise<void> {
  const id = readId(req.params['id'])
  if (id === null) {
    respondError(res, 400, 'bad_request', '资料 ID 不合法')
    return
  }
  const ticket = readTicket(req.query['ticket'])
  if (ticket === null) {
    respondError(res, 401, 'unauthorized', '预览链接无效，请刷新页面')
    return
  }
  const grant = verifyPreviewTicket(ticket, id)
  if (grant === null) {
    respondError(res, 401, 'unauthorized', '预览链接已失效，请刷新页面')
    return
  }
  if (!grant.allowUnlisted) {
    try {
      if ((await isDocListed(id)) === false) {
        respondError(res, 404, 'not_found', '资料不存在或尚未收录')
        return
      }
    } catch (err) {
      respondInternal(res, '查询资料状态失败', err)
      return
    }
  }
  const opened = await openPreview(id)
  if (opened.kind === 'file') {
    // 不写 filename=。ASCII 兜底会把中文变成下划线，PDF 工具栏可能优先显示它。
    // 地址最后一段已经是原文件名，工具栏和「另存为」都读这一段。
    await pipeLocalFile(res, opened.path, { ...opened.options, includeFileName: false }, req)
    return
  }
  await sendPreview(res, opened)
}

type PreviewOpen =
  | { readonly kind: 'error'; readonly status: number; readonly errorKind: DocFileErrorKind; readonly message: string }
  | { readonly kind: 'envelope'; readonly envelope: PreviewEnvelope }
  | { readonly kind: 'file'; readonly path: string; readonly fileName: string; readonly options: PipeBinaryOptions }

async function openPreview(id: string): Promise<PreviewOpen> {
  let detail: DocDetailResponse | null
  try {
    detail = await resolveDocDetail(id)
  } catch (err) {
    const detailText = err instanceof Error ? err.message : String(err)
    console.error(`[docs.file] 解析预览信息失败：${detailText}`)
    return {
      kind: 'error',
      status: 500,
      errorKind: 'internal',
      message: '解析预览信息失败（详见服务端日志）',
    }
  }
  if (detail === null) {
    return { kind: 'error', status: 404, errorKind: 'not_found', message: '资料不存在或尚未收录' }
  }

  const decision = decidePreview(detail.doc.fileType, detail.doc.fileSize)
  if (!decision.streamable) {
    return { kind: 'envelope', envelope: buildPreviewEnvelope(detail, decision) }
  }

  const located = await resolveLocalFile(id)
  if (located?.kind !== 'file') {
    return {
      kind: 'envelope',
      envelope: buildPreviewEnvelope(detail, {
        ...decision,
        streamable: false,
        unsupported: true,
        reason: '本机没有这份原文，暂时不能在线预览',
      }),
    }
  }

  const fileName =
    detail.doc.fileName === '' ? `${detail.doc.id}.${detail.doc.fileType}` : detail.doc.fileName
  const options: PipeBinaryOptions = {
    disposition: 'inline',
    contentType: decision.contentType,
    fileName,
    contentLength: located.size,
    extraHeaders: {
      'X-Preview-Max-Bytes': String(decision.maxBytes),
      'X-Preview-Too-Large': 'false',
      'Referrer-Policy': 'no-referrer',
      // no-store 会让 Chrome 的 PDF 插件拿不到正文：工具栏能写出文件名，页面却是空白。
      // 地址里带票据，缓存只跟着这一条预览链接走。
      'Cache-Control': 'private, max-age=7200',
    },
  }
  return { kind: 'file', path: located.path, fileName, options }
}

function buildPreviewEnvelope(detail: DocDetailResponse, decision: PreviewDecision): PreviewEnvelope {
  return {
    success: true,
    preview: decision,
    id: detail.doc.id,
    title: detail.doc.title,
    fileType: detail.doc.fileType,
    fileSize: detail.doc.fileSize,
    downloadUrl: `/api/docs/${encodeURIComponent(detail.doc.id)}/download`,
  }
}

async function sendPreview(res: Response, opened: PreviewOpen, req?: Request): Promise<void> {
  if (opened.kind === 'error') {
    respondError(res, opened.status, opened.errorKind, opened.message)
    return
  }
  if (opened.kind === 'envelope') {
    respondJson<PreviewEnvelope>(res, 200, opened.envelope)
    return
  }
  await pipeLocalFile(res, opened.path, opened.options, req)
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
  if (await refuseUnlisted(id, res)) return

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
  await pipeLocalFile(res, located.path, downloadOptions, req)
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
async function pipeLocalFile(
  res: Response,
  filePath: string,
  options: PipeBinaryOptions,
  req?: Request,
): Promise<void> {
  const range = parseSingleByteRange(readRangeHeader(req), options.contentLength)
  if (range === 'unsatisfiable') {
    res.status(416)
    res.setHeader('Content-Range', `bytes */${options.contentLength}`)
    res.end()
    return
  }

  const stream =
    range === null
      ? createReadStream(filePath)
      : createReadStream(filePath, { start: range.start, end: range.end })
  const onClientClose = (): void => {
    stream.destroy()
  }
  res.on('close', onClientClose)
  try {
    writeBinaryHeaders(res, options, range)
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

function writeBinaryHeaders(
  res: Response,
  options: PipeBinaryOptions,
  range: { readonly start: number; readonly end: number } | null,
): void {
  const status = range === null ? 200 : 206
  res.status(status)
  res.setHeader('Content-Type', options.contentType)
  res.setHeader(
    'Content-Disposition',
    options.includeFileName === false
      ? options.disposition
      : buildContentDisposition(options.disposition, options.fileName),
  )
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Accept-Ranges', 'bytes')
  if (range === null) {
    if (options.contentLength > 0) {
      res.setHeader('Content-Length', String(options.contentLength))
    }
  } else {
    const length = range.end - range.start + 1
    res.setHeader('Content-Length', String(length))
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${options.contentLength}`)
  }
  for (const [key, value] of Object.entries(options.extraHeaders ?? {})) {
    res.setHeader(key, value)
  }
}

function readRangeHeader(req: Request | undefined): string | undefined {
  const raw = req?.headers.range
  return typeof raw === 'string' ? raw : undefined
}

/**
 * 只认单一字节区间。多段 Range 或认不出的写法返回 null，调用方整文件返回。
 * Chrome 的 PDF 插件按区间拉正文；整段 200 顶回去时，工具栏有文件名，页面是空的。
 */
export function parseSingleByteRange(
  header: string | undefined,
  size: number,
): { readonly start: number; readonly end: number } | 'unsatisfiable' | null {
  if (header === undefined || size <= 0) return null
  const matched = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (matched === null) return null
  const startText = matched[1] ?? ''
  const endText = matched[2] ?? ''
  if (startText === '' && endText === '') return null

  let start: number
  let end: number
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'unsatisfiable'
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText === '' ? size - 1 : Number(endText)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'unsatisfiable'
  }
  if (start < 0 || start >= size || end < start) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

// ------------------------------------------------------------------ 本机文件头

interface PipeBinaryOptions {
  readonly disposition: 'attachment' | 'inline'
  readonly contentType: string
  readonly fileName: string
  /** 已知字节数；0/未知则不设 Content-Length（浏览器按 chunked 收） */
  readonly contentLength: number
  /** false：只写 inline/attachment，文件名交给 URL 最后一段（避免中文被折成下划线） */
  readonly includeFileName?: boolean
  readonly extraHeaders?: Readonly<Record<string, string>> | undefined
}

/** 已下架的资料对公众按「没有这份」处理。管理员仍可打开和下载。 */
async function refuseUnlisted(id: string, res: Response): Promise<boolean> {
  try {
    const listed = await isDocListed(id)
    if (listed !== false) return false
    if (await callerIsAdmin(res)) return false
    respondError(res, 404, 'not_found', '资料不存在或尚未收录')
    return true
  } catch (err) {
    respondInternal(res, '查询资料状态失败', err)
    return true
  }
}

async function callerIsAdmin(res: Response): Promise<boolean> {
  const auth = getAuthContext(res as AuthResponse)
  if (auth === null) return false
  const user = await getPrisma().user.findUnique({
    where: { id: auth.userId },
    select: { isAdmin: true },
  })
  return user?.isAdmin === true
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

/** 预览票据：32 字节 base64url，约 43 字符。拒绝数组和带空格的值。 */
function readTicket(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return /^[A-Za-z0-9_-]{20,128}$/.test(trimmed) ? trimmed : null
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
