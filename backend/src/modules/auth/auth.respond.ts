// 契约（模块内）：auth 模块统一的错误响应出口（router 与中间件共用，保证错误体形状一致）
import type { Response } from 'express'
import { AuthError } from './auth.service.js'
import type {
  AuthErrorBody,
  AuthErrorCode,
  AuthLocals,
  FieldIssue,
  LoginResponse,
  MeResponse,
  RegisterResponse,
} from './auth.types.js'

/** auth 路由可能返回的响应体并集（成功体 + 错误体） */
export type AuthResBody = RegisterResponse | LoginResponse | MeResponse | AuthErrorBody

/** 带 AuthLocals 的响应（登录态放 res.locals.auth） */
export type AuthResponse = Response<AuthResBody, AuthLocals>

/** 参数校验失败 -> 400，fields 逐条指明哪个字段有问题（验收①） */
export function sendValidationIssues(res: AuthResponse, issues: readonly FieldIssue[]): void {
  res.status(400).json(
    buildErrorBody({
      code: 'VALIDATION_FAILED',
      message: summarize(issues),
      fields: issues,
    }),
  )
}

/** 业务/系统错误 -> 状态码由 AuthError 决定；未知异常一律 500 且不泄露内部细节 */
export function respondAuthError(res: AuthResponse, err: unknown): void {
  if (err instanceof AuthError) {
    res
      .status(err.status)
      .json(buildErrorBody({ code: err.code, message: err.message, fields: err.issues }))
    return
  }
  console.error('[auth] 未预期异常：', err)
  res
    .status(500)
    .json(
      buildErrorBody({ code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试', fields: [] }),
    )
}

function buildErrorBody(init: {
  readonly code: AuthErrorCode
  readonly message: string
  readonly fields: readonly FieldIssue[]
}): AuthErrorBody {
  return { success: false, error: { code: init.code, message: init.message, fields: init.fields } }
}

/** message 里带上字段名，前端只读 message 也能知道缺什么 */
function summarize(issues: readonly FieldIssue[]): string {
  if (issues.length === 0) return '请求参数不合法'
  return `请求参数不合法：${issues.map((i) => `${i.field}（${i.message}）`).join('；')}`
}
