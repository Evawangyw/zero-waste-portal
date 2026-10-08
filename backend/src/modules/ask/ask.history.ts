// 首页对话记录：只属于当前登录用户。提问走原有 /api/ask，答完后由前端把这一轮存进来。
import { getPrisma } from '../../db/prisma.js'

const MAX_CONTENT = 12_000
const HISTORY_LIMIT = 80

export interface StoredChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly createdAt: string
}

export async function listChatHistory(userId: string): Promise<readonly StoredChatMessage[]> {
  const rows = await getPrisma().chatMessage.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: HISTORY_LIMIT,
  })
  return rows.reverse().map(toMessage)
}

export async function saveChatTurn(
  userId: string,
  question: string,
  answer: string,
): Promise<readonly StoredChatMessage[]> {
  const prisma = getPrisma()
  const created = await prisma.$transaction([
    prisma.chatMessage.create({
      data: { userId, role: 'user', content: clip(question) },
    }),
    prisma.chatMessage.create({
      data: { userId, role: 'assistant', content: clip(answer) },
    }),
  ])
  return created.map(toMessage)
}

function clip(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= MAX_CONTENT ? trimmed : trimmed.slice(0, MAX_CONTENT)
}

function toMessage(row: {
  readonly id: string
  readonly role: string
  readonly content: string
  readonly createdAt: Date
}): StoredChatMessage {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }
}
