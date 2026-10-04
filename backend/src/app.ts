// 契约：createApp() -> 已配置好的 Express 应用（不监听端口）
// 拆分出 app 与 server 是为了后续测试可直接拿到 app 做 supertest 断言。
import express from 'express'
import type { Express } from 'express'
import { askRouter } from './modules/ask/index.js'
import { docsRouter } from './modules/docs/index.js'
import { healthRouter } from './modules/health/index.js'

export function createApp(): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  // T00：仅 health 一个端点。业务路由（docs/auth/embed）由后续任务卡挂载。
  app.use(healthRouter)

  // T01：WeKnora 对接层对外的两条自建路由
  //   GET  /api/docs -> 资料标题数组（含 custom_metadata）
  //   POST /api/ask  -> SSE 流式问答（服务端持会话，不外泄 sessionId）
  app.use(docsRouter)
  app.use(askRouter)

  return app
}
