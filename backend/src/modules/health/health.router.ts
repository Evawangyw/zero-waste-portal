// 模块边界：health
// 对外只暴露 healthRouter（挂载点由 src/app.ts 决定），不对外泄露内部实现。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { buildHealthResponse, type HealthResponse } from './health.types.js'

/** GET /health -> 200 {"ok":true} */
export const healthRouter: Router = Router()

healthRouter.get('/health', (_req: Request, res: Response<HealthResponse>) => {
  res.status(200).json(buildHealthResponse())
})
