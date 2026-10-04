// 契约：createApp() -> 已配置好的 Express 应用（不监听端口）
// 拆分出 app 与 server 是为了后续测试可直接拿到 app 做 supertest 断言。
import express from 'express'
import type { Express } from 'express'
import { askRouter } from './modules/ask/index.js'
import { authRouter } from './modules/auth/index.js'
import { docsRouter, shelfRouter } from './modules/docs/index.js'
import { healthRouter } from './modules/health/index.js'

export function createApp(): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  // T00：仅 health 一个端点。业务路由（docs/auth/embed）由后续任务卡挂载。
  app.use(healthRouter)

  // T01：WeKnora 对接层对外的两条自建路由
  //   GET  /api/docs/weknora -> 资料标题数组（含 customMetadata），实时透传引擎
  //   POST /api/ask  -> SSE 流式问答（服务端持会话，不外泄 sessionId）
  // T03：书架数据源（查自建 SQLite 索引，不实时打 WeKnora）
  //   GET  /api/docs         -> 筛选/排序/分页/文件名搜索 + total + zeroResult
  //   GET  /api/docs/facets  -> 各筛选维度枚举 + 计数
  // 挂载顺序：shelfRouter 先挂，/api/docs 与 /api/docs/facets 归书架；
  // docsRouter 只剩 /api/docs/weknora，两者路径不重叠，顺序不影响各自行为。
  app.use(shelfRouter)
  app.use(docsRouter)
  app.use(askRouter)

  // T02：自建用户体系（与 WeKnora 账号隔离）
  //   POST /api/auth/register | POST /api/auth/login | GET /api/auth/me
  // 登录守卫 requireAuth 由 auth 模块导出，本卡只用于 /me；下载/提问守卫待 T04/T06 自行挂载。
  app.use(authRouter)

  return app
}
