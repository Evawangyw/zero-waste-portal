// admin 通道（T08lite 管理统计最简页）：本卡唯一的取数出口。
//
// 只调 GET /api/admin/stats/summary（后端守卫见 backend/src/modules/track/track.admin.ts：
// 静态口令 X-Admin-Token 或 isAdmin 管理员 JWT；本页走 JWT 那条，前端不持有也不需要口令）。
//
// 口径解释权在后端 track.stats.ts。前端按 summary 原值显示，含 library 这一组规模数字。
import { ApiError } from './http'
import { request } from './http'
import type {
  AdminShelfResponse,
  AdminShelfUpdateResponse,
  AdminUploadResult,
  ChunkDocumentsResponse,
  ChunkPageResponse,
  StatsSummaryResponse,
} from './types'

/** GET /api/admin/stats/summary —— 看板摘要（**必须带管理员 JWT**，否则 401/403） */
export function fetchStatsSummary(token: string): Promise<StatsSummaryResponse> {
  return request<StatsSummaryResponse>('/admin/stats/summary', { token })
}

export interface AdminUploadFields {
  readonly title: string
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topic: string
  readonly library: string
}

export function fetchChunkDocuments(token: string): Promise<ChunkDocumentsResponse> {
  return request<ChunkDocumentsResponse>('/admin/chunks/documents', { token })
}

export function fetchChunkPage(
  token: string,
  documentId: number,
  page: number,
  pageSize: number,
): Promise<ChunkPageResponse> {
  return request<ChunkPageResponse>('/admin/chunks', {
    token,
    query: { documentId, page, pageSize },
  })
}

/** GET /api/admin/docs —— 管理员翻资料，决定上架还是下架 */
export function fetchAdminShelf(
  token: string,
  query: {
    readonly q?: string
    readonly listed?: '1' | '0' | 'all'
    readonly page?: number
    readonly pageSize?: number
  },
): Promise<AdminShelfResponse> {
  return request<AdminShelfResponse>('/admin/docs', { token, query })
}

/** PATCH /api/admin/docs/:id/listed —— true 上架，false 下架 */
export function setAdminDocListed(
  token: string,
  id: string,
  listed: boolean,
): Promise<AdminShelfUpdateResponse> {
  return request<AdminShelfUpdateResponse>(`/admin/docs/${encodeURIComponent(id)}/listed`, {
    method: 'PATCH',
    token,
    body: { listed },
  })
}

/** POST /api/admin/uploads —— 单独上传一份资料，不和刷新绑在一起 */
export async function uploadAdminDocument(
  token: string,
  file: File,
  fields: AdminUploadFields,
): Promise<AdminUploadResult> {
  const form = new FormData()
  form.set('file', file)
  form.set('title', fields.title)
  form.set('year', fields.year)
  form.set('org', fields.org)
  form.set('docType', fields.docType)
  form.set('topic', fields.topic)
  form.set('library', fields.library)
  const response = await fetch('/api/admin/uploads', {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: form,
  })
  const text = await response.text()
  const parsed: unknown = text === '' ? null : safeParse(text)
  if (!response.ok || !isUploadResult(parsed)) {
    throw new ApiError(response.status, readUploadError(parsed, response.status), parsed)
  }
  return parsed
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function isUploadResult(value: unknown): value is AdminUploadResult {
  if (typeof value !== 'object' || value === null) return false
  const doc = Reflect.get(value, 'doc')
  const somark = Reflect.get(value, 'somark')
  const message =
    typeof somark === 'object' && somark !== null ? Reflect.get(somark, 'message') : undefined
  return (
    Reflect.get(value, 'success') === true &&
    typeof doc === 'object' &&
    doc !== null &&
    typeof message === 'string'
  )
}

function readUploadError(value: unknown, status: number): string {
  if (typeof value === 'object' && value !== null) {
    const error = Reflect.get(value, 'error')
    if (typeof error === 'object' && error !== null) {
      const message = Reflect.get(error, 'message')
      if (typeof message === 'string' && message !== '') return message
    }
  }
  return status === 413 ? '文件超过 50MB' : '上传失败'
}
