// 模块边界：docs（文件层 · 路由）
// 契约：
//   GET /api/docs/:id            -> 200 DocDetailResponse | 404 | 400
//   GET /api/docs/:id/preview    -> 200 流 | 200 PreviewEnvelope(unsupported/tooLarge) | 404
//   GET /api/docs/:id/download   -> 200 流(attachment, 重命名) | 401 | 404  ← requireAuth 保护
//
// 实现要点：
//  - 三条路由都挂在 docs 模块自己的 fileRouter 上（不动 auth/shelf 已验收代码）
//  - 下载用 T02 导出的 requireAuth + getAuthContext 解 JWT，**只 import 不修改**
//  - 预览/下载用 Readable.fromWeb(weknoraClient 的 stream).pipe(res) 流式透传，
//    不把字节读进内存；客户端断开时 abort 上游
//  - 下载日志在**开流之前**写，保证「已授权的下载尝试」一定留痕（写日志失败不阻断下载）
import { Router } from 'express'
import type { Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getAuthContext, requireAuth } from '../auth/index.js'
import type { AuthLocals, AuthRequest } from '../auth/index.js'
import { getPrisma } from '../../db/prisma.js'
import { WeKnoraClient } from '../../weknora/index.js'
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

fileRouter.get('/api/docs/:id', (req: Request, res: Response) => {
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

fileRouter.get('/api/docs/:id/preview', (req: Request, res: Response) => {
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

  await pipeBinary(res, (signal) => WeKnoraClient.fromEnv().previewStream(id, signal), {
    disposition: 'inline',
    // Content-Type 以引擎实际返回的为准（索引里的 file_type 只是判据）
    contentType: decision.contentType,
    fileName:
      detail.doc.fileName === '' ? `${detail.doc.id}.${detail.doc.fileType}` : detail.doc.fileName,
    contentLength: decision.sizeBytes,
    extraHeaders: {
      // 让前端即使不解析 JSON 也能一眼看出阈值（验收④）
      'X-Preview-Max-Bytes': String(decision.maxBytes),
      'X-Preview-Too-Large': 'false',
    },
  })
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

  // 先写下载日志再开流：已授权的下载尝试必须留痕（看板下载排行）
  await writeDownloadLog(getPrisma(), auth.userId, resolved.id, fileName)

  await pipeBinary(res, (signal) => WeKnoraClient.fromEnv().download(id, signal), {
    disposition: 'attachment',
    // 下载不给可读类型，强制 octet-stream 触发浏览器另存为（引擎本身也这么回）
    contentType: 'application/octet-stream',
    fileName,
    contentLength: resolved.fileSize,
    extraHeaders: {
      'X-Download-File-Name': encodeURIComponent(fileName),
      'X-Download-Source': resolved.source,
    },
  })
}

// ------------------------------------------------------------------ 流式透传

interface PipeBinaryOptions {
  readonly disposition: 'attachment' | 'inline'
  readonly contentType: string
  readonly fileName: string
  /** 已知字节数；0/未知则不设 Content-Length（浏览器按 chunked 收） */
  readonly contentLength: number
  readonly extraHeaders?: Readonly<Record<string, string>> | undefined
}

/**
 * 把 weknoraClient 的 ReadableStream 直接 pipe 给浏览器。
 * - 字节全程不落 Node 内存（20MB PDF 与 2GB PDF 走同一条代码路径）
 * - 客户端断开 -> abort 上游请求，WeKnora 立刻停止回源
 * - 上游在开流之前就报错（如 404）-> 转成本层 JSON 错误体，浏览器不会拿到半截文件
 */
async function pipeBinary(
  res: Response,
  open: (signal: AbortSignal) => Promise<{
    contentType: string
    contentLength: number
    stream: ReadableStream<Uint8Array> | null
  }>,
  options: PipeBinaryOptions,
): Promise<void> {
  const controller = new AbortController()
  const onClientClose = (): void => {
    controller.abort()
  }
  res.on('close', onClientClose)

  try {
    const binary = await open(controller.signal)
    if (binary.stream === null) {
      respondError(res, 502, 'upstream_unavailable', '资料源没有返回文件流，请稍后重试')
      return
    }

    res.status(200)
    res.setHeader('Content-Type', options.contentType)
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(options.disposition, options.fileName),
    )
    res.setHeader('Cache-Control', 'private, no-store')
    // X-Content-Type-Options: nosniff 阻止浏览器把 pdf 当 html 执行（引擎也在发，保持一致）
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (options.contentLength > 0) {
      res.setHeader('Content-Length', String(options.contentLength))
    }
    for (const [key, value] of Object.entries(options.extraHeaders ?? {})) {
      res.setHeader(key, value)
    }

    await pipeline(Readable.fromWeb(binary.stream), res)
  } catch (err) {
    // headers 已发出就不能改状态码了；此时只能断开连接（浏览器会看到传输失败）
    if (res.headersSent) {
      res.destroy(err instanceof Error ? err : new Error(String(err)))
      return
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[docs.file] 文件流透传失败：${detail}`)
    respondError(res, 502, 'upstream_unavailable', '资料源暂时不可用，请稍后重试')
  } finally {
    res.off('close', onClientClose)
  }
}

// ------------------------------------------------------------------ 工具

/**
 * 资料 ID 白名单校验：只收 UUID（WeKnora 一律 uuid4 实测）。
 * 顺带挡掉路径穿越型输入（../ 之类），避免拼进引擎路径时出问题。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return UUID_RE.test(trimmed) ? trimmed : null
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
