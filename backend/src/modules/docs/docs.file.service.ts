// 模块边界：docs（文件层 · 业务服务）
// 契约（对外经 docs/index.ts 暴露）：
//   resolveDocDetail(id) -> DocDetailResponse | null   （null = 索引与引擎都没有）
//   decidePreview(...)   -> PreviewDecision            （纯函数，可单测）
//   writeDownloadLog(prisma, userId, docId, fileName) -> DownloadLog 落库
//
// 索引优先：详情/预览/下载的元数据都先查本地 SQLite；索引未收录的新文件才回源 WeKnora。
// 流式透传：预览/下载调用 weknoraClient 拿 ReadableStream，由 router 直接 pipe 到 res，
//          本文件**不读字节**，20MB PDF 也不会进内存。
import { getPrisma } from '../../db/prisma.js'
import type { PrismaClient } from '@prisma/client'
import { WeKnoraClient } from '../../weknora/index.js'
import type { WeKnoraKnowledge } from '../../weknora/index.js'
import { buildDownloadFileName, parseFileMetadata, resolveExtension } from './docs.file.name.js'
import { findIndexedDoc, type IndexedDocRow } from './docs.file.repo.js'
import {
  PREVIEWABLE_EXTENSIONS,
  PREVIEW_CONTENT_TYPES,
  PREVIEW_MAX_BYTES,
  type DocDetail,
  type DocDetailResponse,
  type DocParsedMetadata,
  type PreviewDecision,
} from './docs.file.types.js'
import { isMetadataComplete, toMetadataView } from './docs.file.name.js'

/** 预览阈值：默认 20MB，可用环境变量 PREVIEW_MAX_BYTES 覆盖（非法值回落默认） */
export function loadPreviewMaxBytes(): number {
  const raw = process.env['PREVIEW_MAX_BYTES']
  if (raw === undefined || raw.trim() === '') return PREVIEW_MAX_BYTES
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : PREVIEW_MAX_BYTES
}

/** 预览类型是否浏览器原生可渲染 */
export function isPreviewableExtension(ext: string): boolean {
  return PREVIEWABLE_EXTENSIONS.includes(ext.toLowerCase())
}

/**
 * 预览决策（纯函数，验收④ 用它证明分支可达）。
 * - 扩展名不在白名单 -> unsupported
 * - 体积 > 阈值 -> tooLarge
 * - 体积未知（0）-> 按可预览处理，让浏览器先探；流若中途超限由 HTTP 层断
 */
export function decidePreview(
  ext: string,
  fileSize: number,
  maxBytes: number = loadPreviewMaxBytes(),
): PreviewDecision {
  const normalized = ext.toLowerCase()
  const contentType = PREVIEW_CONTENT_TYPES[normalized] ?? 'application/octet-stream'
  const sizeBytes = Number.isFinite(fileSize) && fileSize > 0 ? Math.trunc(fileSize) : 0

  if (!isPreviewableExtension(normalized)) {
    return {
      streamable: false,
      tooLarge: false,
      unsupported: true,
      contentType,
      sizeBytes,
      maxBytes,
      reason:
        normalized === ''
          ? '无法识别文件类型，请下载后查看'
          : `暂不支持在线预览 .${normalized}，请下载后查看`,
    }
  }
  if (sizeBytes > maxBytes) {
    return {
      streamable: false,
      tooLarge: true,
      unsupported: false,
      contentType,
      sizeBytes,
      maxBytes,
      reason: `文件约 ${formatSize(sizeBytes)}，超过在线预览上限 ${formatSize(maxBytes)}，请下载后查看`,
    }
  }
  return {
    streamable: true,
    tooLarge: false,
    unsupported: false,
    contentType,
    sizeBytes,
    maxBytes,
    reason: null,
  }
}

/**
 * 解析一条资料的详情（索引优先 + 回源补 description/profile）。
 * @returns 索引与引擎都查不到时返回 null（路由转 404）
 */
export async function resolveDocDetail(
  id: string,
  prisma: PrismaClient = getPrisma(),
  client: WeKnoraClient = WeKnoraClient.fromEnv(),
): Promise<DocDetailResponse | null> {
  const indexed = await findIndexedDoc(prisma, id)

  // 回源拿 description（摘要）与 profile.gist（短摘要），索引里没有这两个字段。
  // 回源失败不阻断详情：引擎抖一下不该让详情页 500，只把 upstreamAvailable 给 false。
  const upstream = await fetchKnowledgeSafely(client, id)

  if (indexed === null && upstream === null) return null

  const doc = buildDocDetail(id, indexed, upstream)
  const meta = parseFileMetadata(doc.customMetadata)

  return {
    success: true,
    doc,
    metadata: toMetadataView(meta),
    metadataComplete: isMetadataComplete(meta),
    preview: decidePreview(doc.fileType, doc.fileSize),
    download: {
      allowed: true,
      fileName: buildDownloadFileName(meta.year, meta.org, doc.readableTitle, doc.fileType),
    },
    source: sourceOf(indexed, upstream),
    upstreamAvailable: upstream !== null,
  }
}

/** 已解析的资料视图（供下载路由复用：拿年份/机构/标题拼文件名） */
export interface ResolvedDocForDownload {
  readonly id: string
  readonly title: string
  readonly metadata: DocParsedMetadata
  readonly fileType: string
  readonly fileSize: number
  readonly source: 'index' | 'weknora' | 'index+weknora'
}

/**
 * 下载用解析：与详情同一套逻辑，但只保留拼文件名必需的字段。
 * 同样走「索引优先」，未命中才回源。
 */
export async function resolveDocForDownload(
  id: string,
  prisma: PrismaClient = getPrisma(),
  client: WeKnoraClient = WeKnoraClient.fromEnv(),
): Promise<ResolvedDocForDownload | null> {
  const indexed = await findIndexedDoc(prisma, id)
  const upstream = indexed === null ? await fetchKnowledgeSafely(client, id) : null
  if (indexed === null && upstream === null) return null

  const merged: {
    readonly fileName: string
    readonly title: string
    readonly fileType: string
    readonly fileSize: number
    readonly customMetadata: Readonly<Record<string, unknown>>
  } =
    indexed !== null
      ? {
          fileName: indexed.fileName,
          title: firstNonEmpty([indexed.readableTitle, indexed.title]),
          fileType: resolveExtension(indexed.fileType, indexed.fileName),
          fileSize: indexed.fileSize,
          // 索引没记 custom_metadata（sync 早期版本）时回源补
          customMetadata:
            Object.keys(indexed.customMetadata).length > 0
              ? indexed.customMetadata
              : (upstream?.customMetadata ?? indexed.customMetadata),
        }
      : {
          fileName: upstream?.fileName ?? '',
          title: firstNonEmpty([upstream?.title ?? '', upstream?.fileName ?? '']),
          fileType: resolveExtension(upstream?.fileType, upstream?.fileName),
          fileSize: upstream?.fileSize ?? 0,
          customMetadata: upstream?.customMetadata ?? {},
        }

  return {
    id,
    title: merged.title,
    metadata: parseFileMetadata(merged.customMetadata),
    fileType: merged.fileType,
    fileSize: merged.fileSize,
    source: sourceOf(indexed, upstream),
  }
}

/**
 * 写下载日志（看板：下载排行）。
 * @param fileName 下发给浏览器的重命名文件名（同时存进 docTitle 与 fileName 两列：
 *   docTitle 是历史字段、fileName 是 T04 新增的语义列，看板/排障按语义取，别只写一个）
 * 失败只打日志不抛：下载日志是统计用途，不该让用户已经拿到的文件变成错误页。
 */
export async function writeDownloadLog(
  prisma: PrismaClient,
  userId: string,
  docId: string,
  fileName: string,
): Promise<boolean> {
  try {
    await prisma.downloadLog.create({
      data: { userId, docId, docTitle: fileName, fileName },
    })
    return true
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[docs.file] 写下载日志失败（userId=${userId}, docId=${docId}）：${detail}`)
    return false
  }
}

// ------------------------------------------------------------------ 内部

/** 回源取单条 metadata；任何失败都吞掉转 null（详情页不该因引擎不可用而 500） */
async function fetchKnowledgeSafely(
  client: WeKnoraClient,
  id: string,
): Promise<WeKnoraKnowledge | null> {
  try {
    return await client.getKnowledge(id)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[docs.file] 回源 WeKnora 取单条失败（id=${id}）：${detail}`)
    return null
  }
}

/** 索引行与引擎数据合并；引擎优先补 description/profile/tags 等索引没有的字段 */
function buildDocDetail(
  id: string,
  indexed: IndexedDocRow | null,
  upstream: WeKnoraKnowledge | null,
): DocDetail {
  const fileName = indexed?.fileName !== '' ? (indexed?.fileName ?? '') : (upstream?.fileName ?? '')
  const title = firstNonEmpty([indexed?.title ?? '', upstream?.title ?? '', fileName])
  const readableTitle = firstNonEmpty([indexed?.readableTitle ?? '', title])
  const fileType = resolveExtension(
    firstNonEmpty([indexed?.fileType ?? '', upstream?.fileType ?? '']),
    fileName,
  )
  const fileSize =
    indexed?.fileSize !== undefined && indexed.fileSize > 0
      ? indexed.fileSize
      : (upstream?.fileSize ?? 0)

  return {
    id,
    title,
    readableTitle,
    fileName,
    fileType,
    fileSize,
    summary: emptyToNull(upstream?.description ?? ''),
    gist: emptyToNull(readProfileGist(upstream)),
    folderPath: upstream?.folderPath ?? '',
    parseStatus: upstream?.parseStatus ?? '',
    enableStatus: upstream?.enableStatus ?? '',
    tags: upstream !== null ? [...upstream.tags] : [...(indexed?.tags ?? [])],
    customMetadata:
      Object.keys(indexed?.customMetadata ?? {}).length > 0
        ? (indexed?.customMetadata ?? {})
        : (upstream?.customMetadata ?? {}),
    createdAt: emptyToNull(upstream?.createdAt ?? ''),
    updatedAt: emptyToNull(
      // 索引的 sourceUpdatedAt 是索引里已有的时间戳，回源成功时以引擎为准
      upstream?.updatedAt ?? indexed?.sourceUpdatedAt ?? '',
    ),
  }
}

/** WeKnora profile.gist（引擎摘要短句）；profile 未建模，只能从 raw 取 */
function readProfileGist(upstream: WeKnoraKnowledge | null): string {
  if (upstream === null) return ''
  const profile = upstream.raw['profile']
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return ''
  const gist = (profile as Record<string, unknown>)['gist']
  return typeof gist === 'string' ? gist : ''
}

function sourceOf(
  indexed: IndexedDocRow | null,
  upstream: WeKnoraKnowledge | null,
): 'index' | 'weknora' | 'index+weknora' {
  if (indexed !== null && upstream !== null) return 'index+weknora'
  return indexed !== null ? 'index' : 'weknora'
}

/** 逐个取第一个非空（空白也算空），全空给 '' */
function firstNonEmpty(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (candidate.trim() !== '') return candidate.trim()
  }
  return ''
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${bytes}B`
}
