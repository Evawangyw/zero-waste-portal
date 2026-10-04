// 契约：createApp() -> 已配置好的 Express 应用（不监听端口）
// 拆分出 app 与 server 是为了后续测试可直接拿到 app 做 supertest 断言。
import express from 'express'
import type { Express } from 'express'
import { askRouter } from './modules/ask/index.js'
import { authRouter } from './modules/auth/index.js'
import { docsRouter, fileRouter, shelfRouter } from './modules/docs/index.js'
import { embedRouter } from './modules/embed/index.js'
import { healthRouter } from './modules/health/index.js'
import { trackRouter, trackJsonErrorHandler } from './modules/track/index.js'

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

  // T04：单条资料的文件三路由（docs 模块自己的 fileRouter）
  //   GET /api/docs/:id           -> 详情（元数据全量 + 解析后的年份/机构/类型/领域 + 摘要）
  //   GET /api/docs/:id/preview   -> 在线预览（流式；非原生类型/超 20MB 回 unsupported/tooLarge）
  //   GET /api/docs/:id/download  -> 下载（**登录闸门**：requireAuth 解 JWT；写 DownloadLog + 重命名文件名）
  // 挂载位置说明：必须排在 shelfRouter 之后 —— shelfRouter 只精确匹配 /api/docs 与
  // /api/docs/facets 两个路径，不会吃掉 /api/docs/:id，故顺序只影响可读性不影响行为。
  app.use(fileRouter)

  // T02：自建用户体系（与 WeKnora 账号隔离）
  //   POST /api/auth/register | POST /api/auth/login | GET /api/auth/me
  // 登录守卫 requireAuth 由 auth 模块导出，本卡只用于 /me；下载/提问守卫待 T04/T06 自行挂载。
  app.use(authRouter)

  // T06：挂件凭证交换（安全模式：publish token 只在后端，浏览器只拿 30 分钟短效 session token）
  //   POST /api/embed/token   卡片正式契约（Origin 校验 + 换 session_token + Q1 登录开关）
  //   GET  /api/embed/token   同一处理器的 GET 变体（官方 weknora-widget.js loader 只发 GET）
  //   GET  /api/embed/config  挂件公开配置（channelId/基址/token 接口，无密钥）
  // 路由与 /api/docs/*、/api/auth/*、/api/ask 全不重叠，挂在最后即可。
  app.use(embedRouter)

  // T07：行为统计落库（方案乙 —— webhook 路线已被 V2 实验否决，v0.8.2 无嵌入渠道回调）
  //   POST /api/track               前端埋点统一入口（单条/批量，匿名可传）
  //   GET  /api/admin/stats/summary 管理员看板摘要（静态口令或 isAdmin 用户 JWT）
  // 路径与前面所有路由不重叠，挂在最后即可；不改任何既有模块的行为。
  app.use(trackRouter)

  // T07 兜底错误体：只拦 /api/track，其余路径原样 next(err) 交还 Express 默认处理
  // （保证既有路由的报错行为不变）。必须注册在最后 —— 错误中间件只抓它之前抛出的错误。
  app.use(trackJsonErrorHandler)

  return app
}
