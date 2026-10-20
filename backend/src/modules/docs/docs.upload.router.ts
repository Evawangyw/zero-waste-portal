// POST /api/admin/uploads  管理员上传一份资料到书架（requireAdminAccess + requireAdminUser）
import { Router } from 'express'
import type { Request, Response } from 'express'

import { requireAdminAccess, requireAdminUser } from '../track/track.admin.js'
import { isUploadId, readSomarkJob, requestSomarkConversion } from './docs.somark.js'
import type { SomarkJob } from './docs.somark.js'
import { UploadRejected, locateAdminUploadFile, readUploadForm, storeAdminUpload } from './docs.upload.js'

export const uploadRouter: Router = Router()

uploadRouter.post(
  '/api/admin/uploads',
  requireAdminAccess,
  requireAdminUser,
  (req: Request, res: Response) => {
    void handleUpload(req, res)
  },
)

uploadRouter.get(
  '/api/admin/uploads/:id/somark',
  requireAdminAccess,
  requireAdminUser,
  (req: Request, res: Response) => {
    const id = typeof req.params['id'] === 'string' ? req.params['id'] : ''
    if (!isUploadId(id)) {
      res.status(400).json({
        success: false,
        error: { kind: 'rejected', message: '资料编号不合法' },
      })
      return
    }
    const job = readSomarkJob(id)
    if (job === null) {
      res.status(404).json({
        success: false,
        error: { kind: 'not_found', message: '还没有这份资料的 SoMark 转换记录' },
      })
      return
    }
    res.status(200).json({ success: true, somark: job })
  },
)

async function handleUpload(req: Request, res: Response): Promise<void> {
  try {
    const form = await readUploadForm(req)
    const stored = await storeAdminUpload(form)
    const located = await locateAdminUploadFile(stored.id)
    const somark = await registerSomark(stored, form, located)
    res.status(201).json({ success: true, doc: stored, somark })
  } catch (err) {
    if (err instanceof UploadRejected) {
      res.status(err.status).json({
        success: false,
        error: { kind: 'rejected', message: err.message },
      })
      return
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[docs.upload] 上传失败：${detail}`)
    res.status(500).json({
      success: false,
      error: { kind: 'internal', message: '上传失败（详见服务端日志）' },
    })
  }
}

async function registerSomark(
  stored: { readonly id: string; readonly title: string; readonly fileName: string; readonly fileSize: number },
  form: {
    readonly year: string
    readonly org: string
    readonly docType: string
    readonly topic: string
    readonly library: string
  },
  located: Awaited<ReturnType<typeof locateAdminUploadFile>>,
): Promise<SomarkJob> {
  if (located === null || located.kind !== 'file') {
    return {
      documentId: stored.id,
      status: 'failed',
      message: '原文没有落盘，无法交给 SoMark',
      requestedAt: new Date().toISOString(),
      fileName: stored.fileName,
      fileSize: stored.fileSize,
    }
  }
  return requestSomarkConversion({
    documentId: stored.id,
    filePath: located.path,
    fileName: stored.fileName,
    fileSize: located.size,
    title: stored.title,
    year: form.year,
    org: form.org,
    docType: form.docType,
    topic: form.topic,
    library: form.library,
  })
}
