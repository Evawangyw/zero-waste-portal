// 管理员单独上传一份资料：文件落在 data/uploads，书架用 knowledgeBaseId=admin-upload。
// 不写复现包语料库，所以不会进问答切片；预览和下载走本机文件。
import { randomBytes } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { PrismaClient } from '@prisma/client'

import { getPrisma } from '../../db/prisma.js'
import {
  META_KEY_DOC_TYPE,
  META_KEY_DOMAIN,
  META_KEY_ORG,
  META_KEY_YEAR,
} from './docs.shelf.clean.js'

export const ADMIN_UPLOAD_BASE = 'admin-upload'
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024

const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx'])

export class UploadRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'UploadRejected'
  }
}

export interface StoredUpload {
  readonly id: string
  readonly title: string
  readonly fileName: string
  readonly fileType: string
  readonly fileSize: number
}

export function uploadsRoot(): string {
  const backend = existsBackendRoot()
  return resolve(backend, 'data', 'uploads')
}

function existsBackendRoot(): string {
  const cwd = process.cwd()
  if (cwd.endsWith('/backend') || cwd.endsWith('\\backend')) return cwd
  return resolve(cwd, 'backend')
}

/** 只留文件名，去掉路径和多余空白。 */
export function safeUploadName(original: string): string {
  const base = basename(original).replace(/[\u0000-\u001f]/g, '').trim()
  const cleaned = base.replace(/[\\/]/g, '_')
  return cleaned.length > 180 ? cleaned.slice(-180) : cleaned
}

export function uploadExtension(fileName: string): string {
  return extname(fileName).replace(/^\./, '').toLowerCase()
}

export function assertAllowedUpload(fileName: string, size: number): void {
  const ext = uploadExtension(fileName)
  if (!ALLOWED_EXT.has(ext)) {
    throw new UploadRejected(400, '只接受 pdf、doc、docx、xls、xlsx')
  }
  if (size <= 0) throw new UploadRejected(400, '文件是空的')
  if (size > UPLOAD_MAX_BYTES) throw new UploadRejected(413, '文件超过 50MB')
}

export async function readUploadForm(req: IncomingMessage): Promise<{
  readonly fileName: string
  readonly bytes: Buffer
  readonly title: string
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topic: string
}> {
  const length = Number(req.headers['content-length'] ?? '')
  if (!Number.isFinite(length) || length <= 0) throw new UploadRejected(400, '缺少上传内容')
  if (length > UPLOAD_MAX_BYTES + 1024 * 1024) throw new UploadRejected(413, '文件超过 50MB')
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || !contentType.includes('multipart/form-data')) {
    throw new UploadRejected(400, '请用表单上传文件')
  }

  const headers = new Headers()
  headers.set('content-type', contentType)
  headers.set('content-length', String(length))
  const form = await new Request('http://localhost/api/admin/uploads', {
    method: 'POST',
    headers,
    body: Readable.toWeb(req),
    duplex: 'half',
  }).formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new UploadRejected(400, '请选择文件')
  const fileName = safeUploadName(file.name)
  const bytes = Buffer.from(await file.arrayBuffer())
  assertAllowedUpload(fileName, bytes.byteLength)
  const title = clip(readField(form, 'title'), 200) || titleFromName(fileName)
  return {
    fileName,
    bytes,
    title,
    year: yearOrEmpty(readField(form, 'year')),
    org: clip(readField(form, 'org'), 80),
    docType: clip(readField(form, 'docType'), 40),
    topic: clip(readField(form, 'topic'), 40),
  }
}

export async function storeAdminUpload(
  input: {
    readonly fileName: string
    readonly bytes: Buffer
    readonly title: string
    readonly year: string
    readonly org: string
    readonly docType: string
    readonly topic: string
  },
  prisma: PrismaClient = getPrisma(),
): Promise<StoredUpload> {
  const id = `upload-${randomBytes(8).toString('hex')}`
  const ext = uploadExtension(input.fileName)
  const dir = resolve(uploadsRoot(), id)
  const target = join(dir, input.fileName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(target, input.bytes)

  const custom: Record<string, string> = {}
  if (input.year !== '') custom[META_KEY_YEAR] = input.year
  if (input.org !== '') custom[META_KEY_ORG] = input.org
  if (input.docType !== '') custom[META_KEY_DOC_TYPE] = input.docType
  if (input.topic !== '') custom[META_KEY_DOMAIN] = input.topic
  const topics = input.topic === '' ? [] : [input.topic]

  await prisma.knowledgeIndex.create({
    data: {
      knowledgeId: id,
      knowledgeBaseId: ADMIN_UPLOAD_BASE,
      title: input.title,
      fileName: input.fileName,
      readableTitle: input.title,
      fileType: ext,
      fileSize: input.bytes.byteLength,
      customMetadata: JSON.stringify(custom),
      tags: '[]',
      year: input.year,
      org: input.org,
      docType: input.docType,
      topics: JSON.stringify(topics),
      syncedAt: new Date(),
    },
  })

  return {
    id,
    title: input.title,
    fileName: input.fileName,
    fileType: ext,
    fileSize: input.bytes.byteLength,
  }
}

/** 管理上传的本机原文。null 表示这不是上传编号。 */
export async function locateAdminUploadFile(
  id: string,
  prisma: PrismaClient = getPrisma(),
): Promise<
  { readonly kind: 'file'; readonly path: string; readonly size: number } | { readonly kind: 'missing' } | null
> {
  if (!id.startsWith('upload-')) return null
  const row = await prisma.knowledgeIndex.findUnique({
    where: { knowledgeId: id },
    select: { knowledgeBaseId: true, fileName: true },
  })
  if (row === null || row.knowledgeBaseId !== ADMIN_UPLOAD_BASE || row.fileName === '') {
    return { kind: 'missing' }
  }
  const root = resolve(uploadsRoot(), id)
  const path = join(root, row.fileName)
  if (!path.startsWith(`${root}${sep}`)) return { kind: 'missing' }
  try {
    const size = statSync(path).size
    return { kind: 'file', path, size }
  } catch {
    return { kind: 'missing' }
  }
}

function readField(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

function yearOrEmpty(value: string): string {
  return /^\d{4}$/.test(value) ? value : ''
}

function titleFromName(fileName: string): string {
  const stem = fileName.replace(/\.[a-z0-9]{1,8}$/i, '').trim()
  return stem === '' ? fileName : stem
}
