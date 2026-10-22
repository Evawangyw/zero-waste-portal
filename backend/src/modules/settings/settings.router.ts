// GET  /api/admin/settings          问答参数和用户权限
// PATCH /api/admin/settings         保存问答参数（不回传密钥）
// PATCH /api/admin/settings/users/:id  给予或撤销预览、下载、管理
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getAuthContext } from '../auth/index.js'
import type { AuthLocals } from '../auth/index.js'
import { readVectorIndexModel } from '../ask/ask.embed.js'
import { requireAdminAccess, requireAdminUser } from '../track/track.admin.js'
import { SettingsError, askSettingsView, listUserAccess, saveAskSettings, updateUserAccess } from './settings.store.js'

export const settingsRouter: Router = Router()

settingsRouter.get(
  '/api/admin/settings',
  requireAdminAccess,
  requireAdminUser,
  (_req: Request, res: Response) => {
    void handleGet(res)
  },
)

settingsRouter.patch(
  '/api/admin/settings',
  requireAdminAccess,
  requireAdminUser,
  (req: Request, res: Response) => {
    void handleSave(req, res)
  },
)

settingsRouter.patch(
  '/api/admin/settings/users/:id',
  requireAdminAccess,
  requireAdminUser,
  (req: Request, res: Response) => {
    void handleUser(req, res)
  },
)

async function handleGet(res: Response): Promise<void> {
  try {
    const view = await askSettingsView(readVectorIndexModel())
    const users = await listUserAccess()
    res.status(200).json({ success: true, ...view, users })
  } catch (err) {
    respond(res, err, '读取系统设置失败')
  }
}

async function handleSave(req: Request, res: Response): Promise<void> {
  const parsed = readAskBody(req.body)
  if (parsed === null) {
    res.status(400).json({ success: false, error: { message: '问答设置缺少字段' } })
    return
  }
  try {
    await saveAskSettings(parsed)
    const view = await askSettingsView(readVectorIndexModel())
    res.status(200).json({ success: true, ...view })
  } catch (err) {
    respond(res, err, '保存问答设置失败')
  }
}

async function handleUser(req: Request, res: Response): Promise<void> {
  const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : ''
  const patch = readAccessPatch(req.body)
  if (id === '' || patch === null) {
    res.status(400).json({ success: false, error: { message: '请给出要改的权限' } })
    return
  }
  const actorId = getAuthContext(res as Response<unknown, AuthLocals>)?.userId ?? ''
  try {
    const user = await updateUserAccess(actorId, id, patch)
    res.status(200).json({ success: true, user })
  } catch (err) {
    respond(res, err, '更新用户权限失败')
  }
}

function readAskBody(body: unknown): {
  readonly vectorModel: string
  readonly lexicalK: number
  readonly vectorK: number
  readonly fusedK: number
  readonly bailianModel: string
  readonly bailianBaseUrl: string
  readonly bailianApiKey: string | null
} | null {
  if (typeof body !== 'object' || body === null) return null
  const vectorModel = readString(body, 'vectorModel')
  const bailianModel = readString(body, 'bailianModel')
  const bailianBaseUrl = readString(body, 'bailianBaseUrl')
  const lexicalK = readInt(body, 'lexicalK')
  const vectorK = readInt(body, 'vectorK')
  const fusedK = readInt(body, 'fusedK')
  if (
    vectorModel === null ||
    bailianModel === null ||
    bailianBaseUrl === null ||
    lexicalK === null ||
    vectorK === null ||
    fusedK === null
  ) {
    return null
  }
  const secret = Reflect.get(body, 'bailianApiKey')
  const bailianApiKey = typeof secret === 'string' && secret.trim() !== '' ? secret : null
  return { vectorModel, lexicalK, vectorK, fusedK, bailianModel, bailianBaseUrl, bailianApiKey }
}

function readAccessPatch(body: unknown): {
  readonly canPreview?: boolean
  readonly canDownload?: boolean
  readonly isAdmin?: boolean
} | null {
  if (typeof body !== 'object' || body === null) return null
  const patch: { canPreview?: boolean; canDownload?: boolean; isAdmin?: boolean } = {}
  const preview = readBool(body, 'canPreview')
  const download = readBool(body, 'canDownload')
  const admin = readBool(body, 'isAdmin')
  if (preview !== null) patch.canPreview = preview
  if (download !== null) patch.canDownload = download
  if (admin !== null) patch.isAdmin = admin
  return Object.keys(patch).length === 0 ? null : patch
}

function readString(body: object, key: string): string | null {
  const value = Reflect.get(body, key)
  return typeof value === 'string' ? value : null
}

function readInt(body: object, key: string): number | null {
  const value = Reflect.get(body, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBool(body: object, key: string): boolean | null {
  const value = Reflect.get(body, key)
  return typeof value === 'boolean' ? value : null
}

function respond(res: Response, err: unknown, fallback: string): void {
  if (err instanceof SettingsError) {
    res.status(err.status).json({ success: false, error: { message: err.message } })
    return
  }
  const detail = err instanceof Error ? err.message : String(err)
  console.error(`[settings] ${fallback}：${detail}`)
  res.status(500).json({ success: false, error: { message: fallback } })
}
