// 首页对话记录：只属于当前登录用户。一轮对话一个窗口。
// 契约：
//   openChatWindow(userId, conversationId?) -> 当前窗口 + 该用户的窗口列表 + 消息
//   startChatConversation(userId) -> 新开一个空窗口（当前已经是空窗口则原样返回）
//   clearChatConversation(userId, conversationId) -> 删掉这一窗的消息，窗口还在
//   saveChatTurn(userId, question, answer, thinking, conversationId?) -> 写入当前窗口
import { getPrisma } from '../../db/prisma.js'

const MAX_CONTENT = 12_000
const HISTORY_LIMIT = 80
const CONVERSATION_LIMIT = 30
const TITLE_MAX = 24
const FRESH_TITLE = '新对话'

export interface StoredChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly thinking: string
  readonly createdAt: string
}

export interface StoredConversation {
  readonly id: string
  readonly title: string
  readonly updatedAt: string
}

export interface ChatWindow {
  readonly conversation: StoredConversation
  readonly conversations: readonly StoredConversation[]
  readonly messages: readonly StoredChatMessage[]
}

/** 指定的窗口不属于这个用户，或已经不存在 */
export class UnknownConversationError extends Error {
  constructor() {
    super('找不到这轮对话')
    this.name = 'UnknownConversationError'
  }
}

export async function openChatWindow(
  userId: string,
  conversationId: string | undefined,
): Promise<ChatWindow> {
  await attachLooseMessages(userId)
  const conversation = await resolveConversation(userId, conversationId)
  return readWindow(userId, conversation.id)
}

export async function startChatConversation(userId: string): Promise<ChatWindow> {
  await attachLooseMessages(userId)
  const prisma = getPrisma()
  const latest = await prisma.chatConversation.findFirst({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  })
  if (latest !== null) {
    const count = await prisma.chatMessage.count({ where: { conversationId: latest.id } })
    if (count === 0) return readWindow(userId, latest.id)
  }
  const created = await prisma.chatConversation.create({
    data: { userId, title: FRESH_TITLE },
  })
  return readWindow(userId, created.id)
}

export async function clearChatConversation(
  userId: string,
  conversationId: string,
): Promise<ChatWindow> {
  const prisma = getPrisma()
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: conversationId, userId },
  })
  if (conversation === null) throw new UnknownConversationError()
  await prisma.$transaction([
    prisma.chatMessage.deleteMany({ where: { conversationId: conversation.id, userId } }),
    prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { title: FRESH_TITLE },
    }),
  ])
  return readWindow(userId, conversation.id)
}

export async function saveChatTurn(
  userId: string,
  question: string,
  answer: string,
  thinking = '',
  conversationId: string | undefined = undefined,
): Promise<ChatWindow> {
  await attachLooseMessages(userId)
  const prisma = getPrisma()
  const conversation = await resolveConversation(userId, conversationId)
  const title = conversation.title === FRESH_TITLE ? titleFrom(question) : conversation.title
  await prisma.$transaction([
    prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { title },
    }),
    prisma.chatMessage.create({
      data: {
        userId,
        conversationId: conversation.id,
        role: 'user',
        content: clip(question),
        thinking: '',
      },
    }),
    prisma.chatMessage.create({
      data: {
        userId,
        conversationId: conversation.id,
        role: 'assistant',
        content: clip(answer),
        thinking: clip(thinking),
      },
    }),
  ])
  return readWindow(userId, conversation.id)
}

async function resolveConversation(
  userId: string,
  conversationId: string | undefined,
): Promise<{ readonly id: string; readonly title: string }> {
  const prisma = getPrisma()
  if (conversationId !== undefined) {
    const found = await prisma.chatConversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true, title: true },
    })
    if (found === null) throw new UnknownConversationError()
    return found
  }
  const latest = await prisma.chatConversation.findFirst({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, title: true },
  })
  if (latest !== null) return latest
  return prisma.chatConversation.create({
    data: { userId, title: FRESH_TITLE },
    select: { id: true, title: true },
  })
}

async function readWindow(userId: string, conversationId: string): Promise<ChatWindow> {
  const prisma = getPrisma()
  const [conversation, conversations, rows] = await Promise.all([
    prisma.chatConversation.findFirst({
      where: { id: conversationId, userId },
    }),
    prisma.chatConversation.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: CONVERSATION_LIMIT,
    }),
    prisma.chatMessage.findMany({
      where: { userId, conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    }),
  ])
  if (conversation === null) throw new UnknownConversationError()
  return {
    conversation: toConversation(conversation),
    conversations: conversations.map(toConversation),
    messages: rows.reverse().map(toMessage),
  }
}

/** 把还没分窗口的旧消息收进一轮对话，避免一升级就把历史弄丢。 */
async function attachLooseMessages(userId: string): Promise<void> {
  const prisma = getPrisma()
  const loose = await prisma.chatMessage.findFirst({
    where: { userId, conversationId: null },
    orderBy: { createdAt: 'asc' },
  })
  if (loose === null) return
  const firstQuestion = await prisma.chatMessage.findFirst({
    where: { userId, conversationId: null, role: 'user' },
    orderBy: { createdAt: 'asc' },
  })
  const created = await prisma.chatConversation.create({
    data: { userId, title: titleFrom(firstQuestion?.content ?? loose.content) },
  })
  await prisma.chatMessage.updateMany({
    where: { userId, conversationId: null },
    data: { conversationId: created.id },
  })
}

function titleFrom(question: string): string {
  const compact = question.trim().replace(/\s+/g, ' ')
  if (compact === '') return FRESH_TITLE
  return compact.length <= TITLE_MAX ? compact : `${compact.slice(0, TITLE_MAX)}…`
}

function clip(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= MAX_CONTENT ? trimmed : trimmed.slice(0, MAX_CONTENT)
}

function toConversation(row: {
  readonly id: string
  readonly title: string
  readonly updatedAt: Date
}): StoredConversation {
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toMessage(row: {
  readonly id: string
  readonly role: string
  readonly content: string
  readonly thinking: string
  readonly createdAt: Date
}): StoredChatMessage {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    thinking: row.thinking,
    createdAt: row.createdAt.toISOString(),
  }
}
