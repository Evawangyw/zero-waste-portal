// 契约（模块内）：auth 业务逻辑（注册 / 登录 / 查用户）
// 密码：bcrypt 哈希后落库，明文永不写库、永不进日志、永不回前端（验收⑤）。
// 重复手机号：DB 唯一索引 + 预检双保险，统一 409（验收②）。
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import type { PrismaClient, User } from '@prisma/client'
import { getPrisma } from '../../db/prisma.js'
import { BCRYPT_ROUNDS, loadAuthConfig } from './auth.config.js'
import type { AuthConfig } from './auth.config.js'
import { signAuthToken } from './auth.jwt.js'
import type {
  AuthErrorCode,
  FieldIssue,
  LoginBody,
  LoginResponse,
  PublicUser,
  RegisterBody,
  RegisterResponse,
} from './auth.types.js'

/** 可注入依赖（测试用；线上默认取单例 Prisma + .env 配置） */
export interface AuthDeps {
  readonly prisma?: PrismaClient | undefined
  readonly config?: AuthConfig | undefined
}

/** 模块内统一业务错误：code 决定 HTTP 状态与前端分支 */
export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly status: number
  readonly issues: readonly FieldIssue[]

  constructor(init: {
    readonly code: AuthErrorCode
    readonly status: number
    readonly message: string
    readonly issues?: readonly FieldIssue[] | undefined
  }) {
    super(init.message)
    this.name = 'AuthError'
    this.code = init.code
    this.status = init.status
    this.issues = init.issues ?? []
  }
}

/** 注册：五字段 + 密码哈希 + consent（校验已在路由层完成） */
export async function registerUser(
  body: RegisterBody,
  deps: AuthDeps = {},
): Promise<RegisterResponse> {
  const prisma = deps.prisma ?? getPrisma()

  const existing = await prisma.user.findUnique({
    where: { phone: body.phone },
    select: { id: true },
  })
  if (existing !== null) {
    throw new AuthError({
      code: 'PHONE_TAKEN',
      status: 409,
      message: '该手机号已注册，请直接登录',
    })
  }

  const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS)
  try {
    const user = await prisma.user.create({
      data: {
        name: body.name,
        org: body.org,
        occupation: body.occupation,
        // 关注议题多选 -> JSON 数组串（schema.prisma 注释口径：SQLite 无数组列）
        topics: JSON.stringify(body.topics),
        phone: body.phone,
        passwordHash,
      },
    })
    return { success: true, user: toPublicUser(user) }
  } catch (err) {
    // 并发下两个请求同时通过预检时，靠 DB 唯一索引兜底
    if (isUniqueViolation(err)) {
      throw new AuthError({
        code: 'PHONE_TAKEN',
        status: 409,
        message: '该手机号已注册，请直接登录',
      })
    }
    throw err
  }
}

/** 登录：正确密码签发 JWT（30 天），错误密码/不存在 -> 401（验收③） */
export async function loginUser(body: LoginBody, deps: AuthDeps = {}): Promise<LoginResponse> {
  const prisma = deps.prisma ?? getPrisma()
  const user = await prisma.user.findUnique({ where: { phone: body.phone } })

  // 文案统一「手机号或密码错误」：不区分哪一项错，避免手机号枚举
  const invalid = (): AuthError =>
    new AuthError({
      code: 'INVALID_CREDENTIALS',
      status: 401,
      message: '手机号或密码错误',
    })

  if (user === null) throw invalid()
  const matched = await bcrypt.compare(body.password, user.passwordHash)
  if (!matched) throw invalid()

  const config = deps.config ?? loadAuthConfig()
  const signed = signAuthToken({ sub: user.id, phone: user.phone }, config)
  return {
    success: true,
    token: signed.token,
    tokenType: 'Bearer',
    expiresIn: config.tokenTtlSeconds,
    expiresAt: signed.expiresAt,
    user: toPublicUser(user),
  }
}

/** 按 id 取用户（GET /api/auth/me 用；不存在返回 null） */
export async function findUserById(
  userId: string,
  deps: AuthDeps = {},
): Promise<PublicUser | null> {
  const prisma = deps.prisma ?? getPrisma()
  const user = await prisma.user.findUnique({ where: { id: userId } })
  return user === null ? null : toPublicUser(user)
}

/** 数据库行 -> 对外视图（**唯一**出口：passwordHash 在此被彻底裁掉） */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    org: user.org,
    occupation: user.occupation,
    topics: parseTopics(user.topics),
    phone: user.phone,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
  }
}

/** topics 列存的是 JSON 数组串；脏数据不让 /me 整个 500，降级成空数组 */
function parseTopics(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
