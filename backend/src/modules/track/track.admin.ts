// 模块边界：track（管理员守卫 · 任务卡口径「暂用简单管理员口令，正式 RBAC 是 P2」）
//
// 两条放行路径（任一通过即可）：
//  1. 静态口令：请求头 X-Admin-Token == 环境变量 ADMIN_STATS_TOKEN（常量时间比较）
//     - 未配置 ADMIN_STATS_TOKEN 时该路径**自动失效**（不是 503），回落到第 2 条；
//     - 源码里零口令字面量（红线：密钥只进 backend/.env）。
//  2. 管理员 JWT：Authorization: Bearer <token> 先过 auth 模块导出的 requireAuth
//     （401 由 auth 给，本卡不重复实现鉴权逻辑），再查 users.isAdmin；false -> 403。
//
// 为什么两条而不是只留一条：
//  - 只留静态口令 -> 部署方必须往 .env 加一行（基金会实例交付时才有），本机无法直接验收；
//  - 只留管理员 JWT -> 需要一个"谁能把账号设成管理员"的运维入口（track.admin.cli.ts 给了），
//    且 P2 做真 RBAC 时这条路正是要演进的方向。
//
// 边界声明：本模块只**只读** users.isAdmin 这一个字段，不改 auth 模块任何代码与行为。
import type { RequestHandler, Response } from 'express'
import { getAuthContext, requireAuth } from '../auth/index.js'
import type { AuthLocals, AuthRequest } from '../auth/index.js'
import { getPrisma } from '../../db/prisma.js'
import { loadEnvFile } from '../../weknora/index.js'

/** 静态口令请求头（X-Admin-Token，与 Authorization 分开，避免和 JWT 语义打架） */
export const ADMIN_TOKEN_HEADER = 'x-admin-token'

export interface TrackAdminConfig {
  /** 未配置时为 null（该路径自动失效） */
  readonly adminToken: string | null
}

/** 装配管理员配置：只读环境变量，源码零字面量 */
export function loadTrackAdminConfig(env: NodeJS.ProcessEnv = process.env): TrackAdminConfig {
  const merged = env === process.env ? loadEnvFile(env) : env
  const raw = merged['ADMIN_STATS_TOKEN']
  const token = typeof raw === 'string' ? raw.trim() : ''
  return { adminToken: token === '' ? null : token }
}

/** 守卫之后的响应类型：locals 里除了 auth 什么也不加（见 track.router 注释） */
type GuardResponse = Response<unknown, AuthLocals>

/**
 * 第一道：静态口令命中就放行；否则回落 requireAuth（它会写 res.locals.auth 或回 401）。
 * 注意：**不往 res.locals 塞自定义字段** —— auth 模块的 AuthLocals 是别人模块的类型，
 * 往里加键等于跨模块改契约。这里靠"第二道里 res.locals.auth 是否存在"来区分两条路径
 * （requireAuth 放行时必定写了 auth，所以 auth 缺失 == 走的口令路径）。
 */
export const requireAdminAccess: RequestHandler = (req, res, next): void => {
  const config = loadTrackAdminConfig()
  if (verifyAdminToken(readHeader(req.headers[ADMIN_TOKEN_HEADER]), config)) {
    next()
    return
  }
  requireAuth(req as AuthRequest, res as GuardResponse, next)
}

/** 第二道：口令路径（无 auth）直接放行；JWT 路径查 isAdmin */
export const requireAdminUser: RequestHandler = (_req, res, next): void => {
  void checkAdminUser(res as GuardResponse, next)
}

async function checkAdminUser(res: GuardResponse, next: (err?: unknown) => void): Promise<void> {
  const auth = getAuthContext(res)
  if (auth === null) {
    next()
    return
  }
  try {
    const user = await getPrisma().user.findUnique({
      where: { id: auth.userId },
      select: { isAdmin: true },
    })
    if (user === null || user.isAdmin !== true) {
      respondAdminError(res, 403, 'forbidden', '需要管理员权限（该账号 isAdmin=false）')
      return
    }
    next()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[track] 校验管理员失败：${detail}`)
    respondAdminError(res, 500, 'internal', '校验管理员失败（详见服务端日志）')
  }
}

/**
 * 静态口令比对：常量时间（长度差异也计入 diff，避免按前缀长度早退泄露信息）。
 * 未配置口令（null）时一律 false —— 该路径直接失效，不给"默认口令"留后门。
 */
export function verifyAdminToken(header: string | undefined, config: TrackAdminConfig): boolean {
  if (config.adminToken === null) return false
  if (header === undefined || header === '') return false
  return constantTimeEquals(header.trim(), config.adminToken)
}

export function constantTimeEquals(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let i = 0; i < length; i += 1) {
    // 越界的 charCodeAt 返回 NaN，NaN | 0 === 0，故短的一侧等价于补 0
    diff |= (left.charCodeAt(i) | 0) ^ (right.charCodeAt(i) | 0)
  }
  return diff === 0
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

function respondAdminError(
  res: Response,
  status: 403 | 500,
  kind: 'forbidden' | 'internal',
  message: string,
): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.status(status).json({ success: false, error: { kind, message } })
}
