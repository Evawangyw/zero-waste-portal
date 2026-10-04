// auth 通道（T02）：注册 / 登录 / 取当前用户。
// 前端不存密码哈希类任何东西；JWT 存 localStorage（键名见 constants.ts）。
import { request } from './http'
import type {
  AuthErrorBody,
  LoginBody,
  LoginResponse,
  MeResponse,
  PublicUser,
  RegisterBody,
  RegisterResponse,
} from './types'

/** POST /api/auth/register —— 五字段 + 密码 + 隐私勾选 */
export function register(body: RegisterBody): Promise<RegisterResponse> {
  return request<RegisterResponse>('/auth/register', { method: 'POST', body })
}

/** POST /api/auth/login —— 手机号 + 密码 */
export function login(body: LoginBody): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', { method: 'POST', body })
}

/** GET /api/auth/me —— 带 JWT 取当前用户；未登录时后端回 401 */
export function me(token: string): Promise<MeResponse> {
  return request<MeResponse>('/auth/me', { token })
}

/** 从 ApiError 里取字段级明细（表单逐字段标红用） */
export function fieldIssues(err: unknown): readonly { field: string; message: string }[] {
  if (typeof err !== 'object' || err === null) return []
  const body: unknown = (err as { body?: unknown }).body
  if (typeof body !== 'object' || body === null) return []
  const error: unknown = (body as Record<string, unknown>)['error']
  if (typeof error !== 'object' || error === null) return []
  const fields: unknown = (error as Record<string, unknown>)['fields']
  if (!Array.isArray(fields)) return []
  return fields.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const field: unknown = (item as Record<string, unknown>)['field']
    const message: unknown = (item as Record<string, unknown>)['message']
    if (typeof field !== 'string' || typeof message !== 'string') return []
    return [{ field, message }]
  })
}

/** 错误码（登录页据此区分"密码错"和"手机号没注册"） */
export function authErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const body: unknown = (err as { body?: unknown }).body
  if (typeof body !== 'object' || body === null) return null
  const error: unknown = (body as Record<string, unknown>)['error']
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as Record<string, unknown>)['code']
  return typeof code === 'string' ? code : null
}

export type { PublicUser, AuthErrorBody }
