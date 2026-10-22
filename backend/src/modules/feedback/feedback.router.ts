import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { getAuthContext, requireAuth } from '../auth/index.js'
import type { AuthLocals, AuthRequest } from '../auth/index.js'
import { requireAdminAccess, requireAdminUser } from '../track/index.js'
import { createFeedback, listFeedback, setFeedbackStatus } from './feedback.store.js'
import type { FeedbackStatusFilter } from './feedback.types.js'
import { parseFeedbackCreate, parseFeedbackStatus } from './feedback.validate.js'

export const feedbackRouter: Router = Router()

const optionalAuth: RequestHandler = (req, res, next): void => {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !/^Bearer\s+\S+/i.test(header.trim())) {
    next()
    return
  }
  requireAuth(req as AuthRequest, res as Response<unknown, AuthLocals>, next)
}

feedbackRouter.post('/api/feedback', optionalAuth, (req: Request, res: Response) => {
  void handleCreate(req, res)
})

feedbackRouter.get(
  '/api/admin/feedback',
  requireAdminAccess,
  requireAdminUser,
  (req: Request, res: Response) => {
    void handleList(req, res)
  },
)

feedbackRouter.patch(
  '/api/admin/feedback/:id',
  requireAdminAccess,
  requireAdminUser,
  (req: Request, res: Response) => {
    void handleStatus(req, res)
  },
)

async function handleCreate(req: Request, res: Response): Promise<void> {
  const parsed = parseFeedbackCreate(req.body)
  if (!parsed.ok) {
    res.status(400).json({ success: false, error: { message: parsed.message } })
    return
  }
  const userId = getAuthContext(res as Response<unknown, AuthLocals>)?.userId ?? null
  try {
    const created = await createFeedback(parsed.value, userId)
    res.status(200).json({ success: true, id: created.id })
  } catch (err) {
    respond(res, err, '提交反馈失败')
  }
}

async function handleList(req: Request, res: Response): Promise<void> {
  try {
    const list = await listFeedback(readFilter(req.query['status']))
    res.status(200).json({ success: true, ...list })
  } catch (err) {
    respond(res, err, '读取反馈失败')
  }
}

async function handleStatus(req: Request, res: Response): Promise<void> {
  const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : ''
  const parsed = parseFeedbackStatus(req.body)
  if (id === '' || !parsed.ok) {
    res.status(400).json({
      success: false,
      error: { message: parsed.ok ? '找不到这条反馈' : parsed.message },
    })
    return
  }
  try {
    const item = await setFeedbackStatus(id, parsed.value)
    if (item === null) {
      res.status(404).json({ success: false, error: { message: '找不到这条反馈' } })
      return
    }
    res.status(200).json({ success: true, item })
  } catch (err) {
    respond(res, err, '更新反馈状态失败')
  }
}

function readFilter(value: unknown): FeedbackStatusFilter {
  if (value === 'open' || value === 'done') return value
  return 'all'
}

function respond(res: Response, err: unknown, fallback: string): void {
  const detail = err instanceof Error ? err.message : String(err)
  console.error(`[feedback] ${fallback}：${detail}`)
  if (res.headersSent) return
  res.status(500).json({ success: false, error: { message: fallback } })
}
