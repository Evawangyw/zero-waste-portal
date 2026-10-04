// 模块边界：embed（路由）
// 契约：
//   GET  /api/embed/config   -> 200 EmbedPublicConfigResponse（公开、非敏感；前端据此注入官方挂件 script）
//   POST /api/embed/token    -> 200 EmbedTokenResponse | 403 | 401(Q1) | 502
//   GET  /api/embed/token    -> 同上（官方 weknora-widget.js 安全模式 loader 只会发 GET，
//                              故 GET 与 POST 共用同一个处理器，校验与交换逻辑完全同一份）
//
// 安全闸（顺序固定，不可调换）：
//   1) Origin 必填且命中 WEKNORA_ALLOWED_ORIGINS -> 否则 403（一张 token 都不发）
//   2) REQUIRE_LOGIN_FOR_ASK=true 时挂 T02 的 requireAuth -> 否则 401
//   3) 才拿 publish token 去 WeKnora 换短效 session token
import { Router } from 'express'
import type { Request, RequestHandler, Response } from 'express'
import { requireAuth } from '../auth/index.js'
import { loadEmbedConfig, normalizeOrigin } from './embed.config.js'
import type { EmbedConfig } from './embed.config.js'
import { EmbedError } from './embed.error.js'
import {
  assertOriginAllowed,
  buildTokenResponse,
  buildWidgetConfig,
  exchangeSessionToken,
  isSameOriginBrowserFetch,
  reconstructRequestOrigin,
} from './embed.service.js'
import type {
  EmbedErrorResponse,
  EmbedPublicConfigResponse,
  EmbedTokenResponse,
} from './embed.types.js'

/** 本模块成功/失败响应的联合类型 */
export type EmbedResponseBody = EmbedTokenResponse | EmbedPublicConfigResponse | EmbedErrorResponse

export type EmbedResponse = Response<EmbedResponseBody>

export const embedRouter: Router = Router()

/** GET /api/embed/config —— 挂件公开配置（channelId / 基址 / token 接口路径，无密钥） */
embedRouter.get('/api/embed/config', (_req: Request, res: EmbedResponse) => {
  respondConfig(loadEmbedConfig(), res)
})

/**
 * GET|POST /api/embed/token —— 换短效 session token。
 *
 * 为什么同时开 GET：官方 weknora-widget.js 的安全模式 loader 用
 * `fetch(tokenEndpoint, { method: 'GET', credentials: 'include' })` 取 token，
 * 只认 GET。本卡的正式契约是 POST，故两者指向同一处理器，不存在两套逻辑。
 * GET 形态的副作用是 token 可能出现在代理访问日志里 —— 因此响应头加 no-store，
 * 且该 token 30 分钟过期且只对白名单宿主可读（浏览器侧受同源/CORS 限制）。
 */
embedRouter.get('/api/embed/token', tokenHandler)
embedRouter.post('/api/embed/token', tokenHandler)

/** GET/POST 共用入口（函数声明提升，故可写在路由注册之后） */
function tokenHandler(req: Request, res: Response): void {
  void handleToken(req, res as EmbedResponse)
}

/**
 * 守卫链：Q1 开关关 -> 无守卫（公众免登录）；开 -> 追加 T02 的 requireAuth。
 * 直接复用 auth 模块唯一出口的 requireAuth，不碰它的内部实现。
 */
function buildGuards(config: EmbedConfig): readonly RequestHandler[] {
  return config.requireLoginForAsk ? [requireAuth] : []
}

function handleToken(req: Request, res: EmbedResponse): void {
  const config = loadEmbedConfig()
  const guards = buildGuards(config)

  // 守卫链用 next(err) 风格跑；requireAuth 自己会把 401 写进 res，故这里统一成 async
  let index = 0
  const runNext = (err?: unknown): void => {
    if (err !== undefined) {
      respondError(res, EmbedError.from(err, '挂件凭证守卫异常'))
      return
    }
    const guard = guards[index]
    if (guard === undefined) {
      void issueToken(req, res, config)
      return
    }
    index += 1
    guard(req, res, runNext)
  }

  applyCors(req, res)
  runNext()
}

async function issueToken(req: Request, res: EmbedResponse, config: EmbedConfig): Promise<void> {
  try {
    // 同源浏览器请求（Sec-Fetch-Site: same-origin）没有 Origin 头，用 Host 还原本站 Origin
    const fallback = isSameOriginBrowserFetch(req) ? reconstructRequestOrigin(req) : undefined
    const origin = assertOriginAllowed(req.headers.origin, config.allowedOrigins, fallback)
    const result = await exchangeSessionToken(config, origin)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json(buildTokenResponse(result))
  } catch (err) {
    respondError(res, EmbedError.from(err, '挂件凭证交换失败'))
  }
}

function respondConfig(config: EmbedConfig, res: EmbedResponse): void {
  applyCors(res.req, res)
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({ success: true, widget: buildWidgetConfig(config) })
}

// ------------------------------------------------------------------ CORS

/**
 * 仅对白名单内的 Origin 回 CORS 头（回显具体 origin，不回 '*'，配合 credentials:'include'）。
 * 同源代理（vite dev / nginx 生产）下这些都是多余头，不影响行为；
 * 保留是为了前端若改成直连 :4000 也不必改后端。
 */
function applyCors(req: Request, res: EmbedResponse): void {
  const allowed = loadEmbedConfig().allowedOrigins
  const origin = normalizeOrigin(req.headers.origin)
  if (origin === '' || !allowed.includes(origin)) return
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin as string)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization')
}

// ------------------------------------------------------------------ 错误

function respondError(res: EmbedResponse, error: EmbedError): void {
  if (error.status >= 500) {
    console.error(`[embed] ${error.kind}：${error.message}`)
  }
  const body: EmbedErrorResponse = {
    success: false,
    error: { kind: error.kind, message: error.message },
  }
  res.setHeader('Cache-Control', 'no-store')
  res.status(error.status).json(body)
}
