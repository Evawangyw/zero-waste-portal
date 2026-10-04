// 模块边界：auth（T02 注册登录）
// 对外只暴露 authRouter（挂载点由 src/app.ts 决定）+ 登录守卫 requireAuth（T04/T06 用）。
//
// 路由契约：
//   POST /api/auth/register  五字段 + 密码 + consent 全校验 -> 201（不回传密码哈希）
//   POST /api/auth/login     手机号 + 密码 -> 200 { token, expiresAt, user }
//   GET  /api/auth/me        requireAuth 保护 -> 200 { user }（五字段，不含密码哈希）
import { Router } from 'express'
import { respondAuthError, sendValidationIssues } from './auth.respond.js'
import type { AuthResponse } from './auth.respond.js'
import { requireAuth } from './auth.middleware.js'
import type { AuthRequest } from './auth.middleware.js'
import { AuthError, findUserById, loginUser, registerUser } from './auth.service.js'
import { parseLoginBody, parseRegisterBody } from './auth.validate.js'

export const authRouter: Router = Router()

/** POST /api/auth/register */
authRouter.post('/api/auth/register', (req, res) => {
  void handleRegister(req as AuthRequest, res as AuthResponse)
})

async function handleRegister(req: AuthRequest, res: AuthResponse): Promise<void> {
  const parsed = parseRegisterBody(req.body)
  if (!parsed.ok) {
    sendValidationIssues(res, parsed.issues)
    return
  }
  try {
    const result = await registerUser(parsed.value)
    res.status(201).json(result)
  } catch (err) {
    respondAuthError(res, err)
  }
}

/** POST /api/auth/login */
authRouter.post('/api/auth/login', (req, res) => {
  void handleLogin(req as AuthRequest, res as AuthResponse)
})

async function handleLogin(req: AuthRequest, res: AuthResponse): Promise<void> {
  const parsed = parseLoginBody(req.body)
  if (!parsed.ok) {
    sendValidationIssues(res, parsed.issues)
    return
  }
  try {
    const result = await loginUser(parsed.value)
    res.status(200).json(result)
  } catch (err) {
    respondAuthError(res, err)
  }
}

/** GET /api/auth/me（JWT 中间件保护；不带 token -> 401） */
authRouter.get('/api/auth/me', requireAuth, (_req, res) => {
  void handleMe(res as AuthResponse)
})

async function handleMe(res: AuthResponse): Promise<void> {
  try {
    const userId = res.locals.auth?.userId
    if (userId === undefined) {
      throw new AuthError({ code: 'AUTH_REQUIRED', status: 401, message: '缺少登录态' })
    }
    const user = await findUserById(userId)
    if (user === null) {
      throw new AuthError({ code: 'USER_GONE', status: 401, message: '账号不存在，请重新登录' })
    }
    res.status(200).json({ success: true, user })
  } catch (err) {
    respondAuthError(res, err)
  }
}
