// 契约：createApp() -> 已配置好的 Express 应用（不监听端口）
// 拆分出 app 与 server 是为了后续测试可直接拿到 app 做 supertest 断言。
import express from 'express'
import type { Express } from 'express'
import { healthRouter } from './modules/health/index.js'

export function createApp(): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  // T00：仅 health 一个端点。业务路由（docs/auth/embed）由后续任务卡挂载。
  app.use(healthRouter)

  return app
}
