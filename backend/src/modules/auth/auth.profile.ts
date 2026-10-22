// 普通用户的个人主页。只读当前用户自己的提问和下载，不写对话、不写下记录。
// 管理员不使用这个页面：调用方收到 NOT_FOR_ADMIN。
import { getPrisma } from '../../db/prisma.js'
import type { AuthDeps } from './auth.service.js'
import { AuthError, toPublicUser } from './auth.service.js'
import type { ProfileDownload, ProfileHomeResponse, ProfileQuestion } from './auth.types.js'

/** 列表最多返回这么多条；总数另计，页面可以说明还有更早的记录 */
export const PROFILE_LIST_LIMIT = 50

export interface ProfileChatRow {
  readonly id: string
  readonly role: string
  readonly content: string
  readonly createdAt: Date
}

/**
 * 按时间把一问一答配成一轮。入参必须从早到晚。
 * 没有紧跟着的回答时，answer 为空。结果从新到旧，最多 limit 条。
 */
export function pairProfileQuestions(
  rows: readonly ProfileChatRow[],
  limit: number,
): readonly ProfileQuestion[] {
  const turns: ProfileQuestion[] = []
  let pending: ProfileQuestion | null = null
  for (const row of rows) {
    if (row.role === 'user') {
      if (pending !== null) turns.push(pending)
      pending = {
        id: row.id,
        question: row.content,
        answer: '',
        createdAt: toIso(row.createdAt),
      }
      continue
    }
    if (row.role === 'assistant' && pending !== null && pending.answer === '') {
      pending = { ...pending, answer: row.content }
      turns.push(pending)
      pending = null
    }
  }
  if (pending !== null) turns.push(pending)
  const newestFirst = turns.slice().reverse()
  return newestFirst.slice(0, limit)
}

/** 读取个人主页。userId 必须来自已校验的登录态，不能由调用方指定别人的 id。 */
export async function loadProfileHome(
  userId: string,
  deps: AuthDeps = {},
): Promise<ProfileHomeResponse> {
  const prisma = deps.prisma ?? getPrisma()
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (user === null) {
    throw new AuthError({ code: 'USER_GONE', status: 401, message: '账号不存在，请重新登录' })
  }
  if (user.isAdmin) {
    throw new AuthError({
      code: 'NOT_FOR_ADMIN',
      status: 403,
      message: '个人主页只开放给普通用户',
    })
  }

  const [questionTotal, downloadTotal, messages, downloads] = await Promise.all([
    prisma.chatMessage.count({ where: { userId, role: 'user' } }),
    prisma.downloadLog.count({ where: { userId } }),
    prisma.chatMessage.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PROFILE_LIST_LIMIT * 2,
      select: { id: true, role: true, content: true, createdAt: true },
    }),
    prisma.downloadLog.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PROFILE_LIST_LIMIT,
      select: { id: true, docId: true, docTitle: true, fileName: true, createdAt: true },
    }),
  ])

  return {
    success: true,
    user: toPublicUser(user),
    questions: pairProfileQuestions([...messages].reverse(), PROFILE_LIST_LIMIT),
    questionTotal,
    downloads: downloads.map((row) => toDownload(row)),
    downloadTotal,
  }
}

function toDownload(row: {
  readonly id: string
  readonly docId: string
  readonly docTitle: string
  readonly fileName: string
  readonly createdAt: Date
}): ProfileDownload {
  return {
    id: row.id,
    docId: row.docId,
    docTitle: row.docTitle,
    fileName: row.fileName,
    createdAt: toIso(row.createdAt),
  }
}

function toIso(value: Date): string {
  return Number.isNaN(value.getTime()) ? '' : value.toISOString()
}
