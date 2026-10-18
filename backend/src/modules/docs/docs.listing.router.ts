// GET  /api/admin/docs                 管理员列出资料（可搜标题，可筛上架/下架）
// PATCH /api/admin/docs/:id/listed     { listed: boolean } 上架或下架
import { Router } from 'express'
import type { Request, Response } from 'express'

import { requireAdminAccess, requireAdminUser } from '../track/track.admin.js'
import { ADMIN_SHELF_PAGE_SIZE, queryAdminShelf, setDocListed } from './docs.listing.js'

export const listingRouter: Router = Router()

listingRouter.get('/api/admin/docs', requireAdminAccess, requireAdminUser, (req: Request, res: Response) => {
  void handleList(req, res)
})

listingRouter.patch(
  '/api/admin/docs/:id/listed',
  requireAdminAccess,
  requireAdminUser,
  (req: Request, res: Response) => {
    void handleSet(req, res)
  },
)

async function handleList(req: Request, res: Response): Promise<void> {
  try {
    const page = await queryAdminShelf({
      q: readText(req.query['q']),
      listed: readListedFilter(req.query['listed']),
      page: readPositiveInt(req.query['page'], 1),
      pageSize: readPositiveInt(req.query['pageSize'], ADMIN_SHELF_PAGE_SIZE),
    })
    res.status(200).json(page)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[docs.listing] 列表失败：${detail}`)
    res.status(500).json({ success: false, error: { kind: 'internal', message: '资料列表加载失败' } })
  }
}

async function handleSet(req: Request, res: Response): Promise<void> {
  const id = readDocId(req.params['id'])
  if (id === null) {
    res.status(400).json({ success: false, error: { kind: 'bad_request', message: '资料编号不合法' } })
    return
  }
  const listed = readListedBody(req.body)
  if (listed === null) {
    res.status(400).json({ success: false, error: { kind: 'bad_request', message: '请给出 listed：true 上架，false 下架' } })
    return
  }
  try {
    const doc = await setDocListed(id, listed)
    if (doc === null) {
      res.status(404).json({ success: false, error: { kind: 'not_found', message: '资料不在书架索引里' } })
      return
    }
    res.status(200).json({ success: true, doc })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[docs.listing] 上下架失败：${detail}`)
    res.status(500).json({ success: false, error: { kind: 'internal', message: '上下架失败' } })
  }
}

function readText(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw.trim() : ''
}

function readPositiveInt(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

/** 1 = 只看上架，0 = 只看下架，缺省或 all = 全部 */
function readListedFilter(value: unknown): boolean | null {
  const text = readText(value)
  if (text === '1' || text === 'true') return true
  if (text === '0' || text === 'false') return false
  return null
}

function readListedBody(body: unknown): boolean | null {
  if (typeof body !== 'object' || body === null) return null
  const listed = Reflect.get(body, 'listed')
  return typeof listed === 'boolean' ? listed : null
}

function readDocId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (id === '' || id.length > 80 || id.includes('/') || id.includes('..')) return null
  return id
}
