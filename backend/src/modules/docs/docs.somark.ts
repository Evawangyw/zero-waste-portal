// SoMark 转换接口。上传成功后调用接口，把 Markdown 写入语料库。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createSomarkClient, readSomarkKeys } from './docs.somark.api.js'
import { ingestSomarkMarkdown } from './docs.somark.ingest.js'
import { uploadsRoot } from './docs.upload.js'

/** 与复现包一致：同步小文件，超过这个体积改走异步任务 */
export const SOMARK_ASYNC_BYTES = 30 * 1024 * 1024

export const SOMARK_STATUSES = ['pending', 'running', 'done', 'failed'] as const

export type SomarkStatus = (typeof SOMARK_STATUSES)[number]

/** 交给转换器的一份已落盘原文，附带书架上要保留的字段 */
export interface SomarkConvertInput {
  readonly documentId: string
  readonly filePath: string
  readonly fileName: string
  readonly fileSize: number
  readonly title: string
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topic: string
}

/** 转换器成功时交回的 Markdown。null 表示这次还没转换 */
export interface SomarkMarkdown {
  readonly markdown: string
  readonly pages: number
}

/**
 * SoMark 客户端。
 * convert 返回 null：任务保持 pending，不写 Markdown。
 * 以后的实现调用 https://somark.cn/api/v1/parse/sync（大文件走 /parse/async），
 * 密钥只从环境变量 SOMARK_API_KEY 读取，不进代码。
 */
export interface SomarkClient {
  convert(input: SomarkConvertInput): Promise<SomarkMarkdown | null>
}

/** 一份资料的转换状态，上传响应和查询接口用同一形状 */
export interface SomarkJob {
  readonly documentId: string
  readonly status: SomarkStatus
  readonly message: string
  readonly requestedAt: string
  readonly fileName: string
  readonly fileSize: number
}

const PENDING_MESSAGE = '已登记，SoMark 转换尚未接通'

/** 默认客户端：不发网络请求 */
export const pendingSomarkClient: SomarkClient = {
  convert(): Promise<SomarkMarkdown | null> {
    return Promise.resolve(null)
  },
}

export function createPendingSomarkJob(input: SomarkConvertInput, now: Date = new Date()): SomarkJob {
  return {
    documentId: input.documentId,
    status: 'pending',
    message: PENDING_MESSAGE,
    requestedAt: now.toISOString(),
    fileName: input.fileName,
    fileSize: input.fileSize,
  }
}

function clientFromEnv(): SomarkClient {
  const keys = readSomarkKeys()
  if (keys.length === 0) return pendingSomarkClient
  return createSomarkClient(keys)
}

/** 上传之后调用。没有密钥时只登记；有密钥则转换并入库。 */
export async function requestSomarkConversion(
  input: SomarkConvertInput,
  client: SomarkClient = clientFromEnv(),
): Promise<SomarkJob> {
  const job = createPendingSomarkJob(input)
  writeSomarkJob(job)
  try {
    const converted = await client.convert(input)
    if (converted === null) return job
    if (converted.markdown.trim().length < 20) {
      const empty: SomarkJob = { ...job, status: 'failed', message: 'SoMark 没有转出可用的正文' }
      writeSomarkJob(empty)
      return empty
    }
    const stored = await ingestSomarkMarkdown(input, converted)
    const done: SomarkJob = {
      ...job,
      status: 'done',
      message: `已转换为 Markdown 并入库，共 ${converted.pages} 页、${stored.chunks} 段`,
    }
    writeSomarkJob(done)
    return done
  } catch (error) {
    const failed: SomarkJob = {
      ...job,
      status: 'failed',
      message: error instanceof Error && error.message !== '' ? error.message : 'SoMark 转换失败',
    }
    writeSomarkJob(failed)
    return failed
  }
}

export function readSomarkJob(documentId: string): SomarkJob | null {
  if (!isUploadId(documentId)) return null
  try {
    return parseSomarkJob(readFileSync(jobPath(documentId), 'utf8'))
  } catch {
    return null
  }
}

export function isUploadId(id: string): boolean {
  return /^upload-[0-9a-f]{16}$/iu.test(id)
}

function writeSomarkJob(job: SomarkJob): void {
  const dir = join(uploadsRoot(), job.documentId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(jobPath(job.documentId), JSON.stringify(job))
}

function jobPath(documentId: string): string {
  return join(uploadsRoot(), documentId, 'somark.json')
}

function parseSomarkJob(text: string): SomarkJob | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const documentId = readString(parsed, 'documentId')
  const status = readString(parsed, 'status')
  const message = readString(parsed, 'message')
  const requestedAt = readString(parsed, 'requestedAt')
  const fileName = readString(parsed, 'fileName')
  const fileSize = readNumber(parsed, 'fileSize')
  if (!isUploadId(documentId) || !isStatus(status) || message === '' || requestedAt === '') return null
  return { documentId, status, message, requestedAt, fileName, fileSize }
}

function isStatus(value: string): value is SomarkStatus {
  return (SOMARK_STATUSES as readonly string[]).includes(value)
}

function readString(record: object, key: string): string {
  const value = Reflect.get(record, key)
  return typeof value === 'string' ? value : ''
}

function readNumber(record: object, key: string): number {
  const value = Reflect.get(record, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
