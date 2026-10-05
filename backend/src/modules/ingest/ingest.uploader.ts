// 契约（模块内）：真实 WeKnora 上传实现（WeKnoraClient 的适配）
// 幂等的实现口径：导入前先 listExistingFileNames() 拿库里已有文件名集合，
// 命中即跳过（不靠上传接口去重 —— 上传接口非幂等，重复调会造重复条目）。
import { readFile } from 'node:fs/promises'
import type { WeKnoraClient } from '../../weknora/index.js'
import type { IngestUploader, UploadFileParams } from './ingest.types.js'

/** 扩展名 -> Content-Type（WeKnora 靠 Content-Type 判类型，给不对会解析失败） */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
}

/** 扩展名 -> WeKnora file_type（用于报告留档；实际上游按 Content-Type 判） */
export function resolveContentType(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = fileName.slice(dot).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** 基于 WeKnoraClient 的上传器（生产路径；单测可注入假实现） */
export function createWeKnoraUploader(client: WeKnoraClient): IngestUploader {
  return {
    async listExistingFileNames(knowledgeBaseId: string): Promise<ReadonlySet<string>> {
      return client.listExistingFileNames(knowledgeBaseId)
    },

    async uploadFile(params: UploadFileParams): Promise<string> {
      const fileBytes = await readFile(params.filePath)
      const result = await client.uploadFile({
        knowledgeBaseId: params.knowledgeBaseId,
        fileName: params.fileName,
        fileBytes,
        contentType: resolveContentType(params.fileName),
        metadata: params.metadata,
      })
      return result.id
    },

    async writeMetadata(
      knowledgeId: string,
      metadata: Readonly<Record<string, string>>,
    ): Promise<void> {
      await client.updateKnowledgeMetadata(knowledgeId, metadata)
    },
  }
}

/** 把任意异常压成一行可读原因（报告里直接展示，不塞堆栈） */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const kind =
      'kind' in err && typeof (err as { kind?: unknown }).kind === 'string'
        ? ` [${(err as { kind: string }).kind}]`
        : ''
    const status =
      'status' in err && typeof (err as { status?: unknown }).status === 'number'
        ? ` (HTTP ${(err as { status: number }).status})`
        : ''
    const snippet =
      'responseSnippet' in err ? (err as { responseSnippet?: string }).responseSnippet : undefined
    const tail = snippet !== undefined && snippet !== '' ? ` :: ${snippet.slice(0, 200)}` : ''
    return `${err.name}${kind}${status} ${err.message}${tail}`
  }
  return String(err)
}
