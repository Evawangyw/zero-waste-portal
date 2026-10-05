// docs 通道（T03 书架 + T04 详情/预览/下载）：只调自建后端，不直接碰 WeKnora。
import { request } from './http'
import type {
  DocDetailResponse,
  PreviewEnvelope,
  ShelfFacetsResponse,
  ShelfListResponse,
  ShelfSort,
} from './types'

/** 书架查询参数（与后端 ShelfQuery 一一对应；空串/undefined 后端会忽略） */
export interface ShelfQueryInput {
  readonly type?: readonly string[]
  readonly org?: readonly string[]
  readonly year?: readonly string[]
  readonly tag?: readonly string[]
  readonly q?: string
  readonly page?: number
  readonly pageSize?: number
  readonly sort?: ShelfSort
}

/** GET /api/docs —— 筛选/排序/分页/文件名搜索 */
export function fetchShelf(query: ShelfQueryInput = {}): Promise<ShelfListResponse> {
  return request<ShelfListResponse>('/docs', {
    query: {
      type: joinMulti(query.type),
      org: joinMulti(query.org),
      year: joinMulti(query.year),
      tag: joinMulti(query.tag),
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
    },
  })
}

/** GET /api/docs/facets —— 各维度枚举 + 计数 */
export function fetchFacets(): Promise<ShelfFacetsResponse> {
  return request<ShelfFacetsResponse>('/docs/facets')
}

/**
 * 书架总条数（P2-5：首页「共 N 条」原来硬编码 42，数据一变就失配）。
 * 用 pageSize=1 只取 total，不浪费带宽也不受分页影响。
 */
export async function fetchShelfTotal(): Promise<number> {
  const response = await fetchShelf({ page: 1, pageSize: 1 })
  return response.total
}

/** GET /api/docs/:id —— 详情（元数据 + 摘要 + 预览/下载可用性） */
export function fetchDocDetail(id: string): Promise<DocDetailResponse> {
  return request<DocDetailResponse>(`/docs/${encodeURIComponent(id)}`)
}

/** GET /api/docs/:id/preview —— 在线预览（可能回二进制，也可能回 PreviewEnvelope） */
export function fetchDocPreview(id: string): Promise<Response> {
  return request<Response>(`/docs/${encodeURIComponent(id)}/preview`, { raw: true })
}

/** GET /api/docs/:id/download —— 下载（**必须带 JWT**，后端写下载日志） */
export function fetchDocDownload(id: string, token: string): Promise<Response> {
  return request<Response>(`/docs/${encodeURIComponent(id)}/download`, { token, raw: true })
}

/** 多选维度拼成逗号串（后端两种写法都吃，这里统一用逗号） */
function joinMulti(values: readonly string[] | undefined): string | undefined {
  if (values === undefined || values.length === 0) return undefined
  const kept = values.map((v) => v.trim()).filter((v) => v !== '')
  return kept.length === 0 ? undefined : kept.join(',')
}

/** 预览回的是"不可预览信封"时，页面据此改走下载引导 */
export function isPreviewEnvelope(value: unknown): value is PreviewEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record['success'] === true && typeof record['preview'] === 'object'
}
