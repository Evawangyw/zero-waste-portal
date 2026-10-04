// 模块边界：docs（书架层 · 路由）
// 契约：
//   GET /api/docs            -> 200 ShelfListResponse（查 SQLite，不打 WeKnora）
//   GET /api/docs/facets     -> 200 ShelfFacetsResponse
// 参数：type/org/year/tag（逗号分隔多选，可重复传同名参数）、q、page、pageSize、sort
// 说明：非法参数一律忽略并回落默认（前端传错不打断页面），只有参数类型彻底不可用才 400。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getPrisma } from '../../db/prisma.js'
import { loadDefaultKnowledgeBaseId } from '../../weknora/index.js'
import { queryFacets, queryShelf } from './docs.shelf.repo.js'
import {
  SHELF_MAX_PAGE_SIZE,
  SHELF_PAGE_SIZE,
  SHELF_SORTS,
  type ShelfErrorResponse,
  type ShelfFacetsResponse,
  type ShelfListResponse,
  type ShelfQuery,
  type ShelfSort,
} from './docs.shelf.types.js'

export const shelfRouter: Router = Router()

shelfRouter.get('/api/docs', (req: Request, res: Response) => {
  void handleShelf(req, res)
})

shelfRouter.get('/api/docs/facets', (_req: Request, res: Response) => {
  void handleFacets(res)
})

async function handleShelf(req: Request, res: Response): Promise<void> {
  const query = parseShelfQuery(req.query)
  try {
    const result = await queryShelf(getPrisma(), query)
    respondOk<ShelfListResponse>(res, result)
  } catch (err) {
    respondError(res, '查询书架失败', err)
  }
}

async function handleFacets(res: Response): Promise<void> {
  try {
    const result = await queryFacets(getPrisma(), loadDefaultKnowledgeBaseId())
    respondOk<ShelfFacetsResponse>(res, result)
  } catch (err) {
    respondError(res, '查询筛选项失败', err)
  }
}

// ------------------------------------------------------------------ 参数解析

/**
 * 解析 query。支持 `?type=A,B` 与 `?type=A&type=B` 两种多选写法。
 * 维度值去重并剔除空串；'未标注' 作为哨兵原样保留（由 repo 层翻译成"该列为空"）。
 */
export function parseShelfQuery(raw: unknown): ShelfQuery {
  const q = isRecord(raw) ? raw : {}
  const page = readPositiveInt(single(q['page']), 1)
  const pageSize = Math.min(
    readPositiveInt(single(q['pageSize']), SHELF_PAGE_SIZE),
    SHELF_MAX_PAGE_SIZE,
  )
  return {
    knowledgeBaseId: readNonEmpty(single(q['knowledgeBaseId'])),
    types: readMulti(q['type']),
    orgs: readMulti(q['org']),
    years: readMulti(q['year']),
    tags: readMulti(q['tag']),
    q: readNonEmpty(single(q['q'])) ?? null,
    page,
    pageSize,
    sort: readSort(single(q['sort'])),
  }
}

function readSort(value: string | undefined): ShelfSort {
  return value !== undefined && (SHELF_SORTS as readonly string[]).includes(value)
    ? (value as ShelfSort)
    : 'year_desc'
}

/** 多选取值：数组或逗号串都吃；去重保序 */
function readMulti(value: unknown): readonly string[] {
  const parts: string[] = []
  const push = (raw: unknown): void => {
    if (typeof raw !== 'string') return
    for (const piece of raw.split(',')) {
      const trimmed = piece.trim()
      if (trimmed !== '') parts.push(trimmed)
    }
  }
  if (Array.isArray(value)) value.forEach(push)
  else push(value)

  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    if (seen.has(part)) continue
    seen.add(part)
    out.push(part)
  }
  return out
}

/** 同名参数只取第一个（重复的其余忽略，避免语义歧义） */
function single(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0]
  return typeof value === 'string' ? value : undefined
}

function readNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

// ------------------------------------------------------------------ 响应

function respondOk<T>(res: Response, body: T): void {
  res.status(200).json(body)
}

/** 统一错误体；对外不暴露内部堆栈细节 */
function respondError(res: Response, message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err)
  console.error(`[docs.shelf] ${message}：${detail}`)
  const body: ShelfErrorResponse = {
    success: false,
    error: { kind: 'internal', message: `${message}（详见服务端日志）` },
  }
  res.status(500).json(body)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
