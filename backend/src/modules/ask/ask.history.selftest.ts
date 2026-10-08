// 验收：每个用户只看见自己的窗口；新对话另开一轮；清空只删当前窗口；旧消息会补进窗口。
// 跑完删除自己建的测试用户。
import { getPrisma } from '../../db/prisma.js'
import {
  clearChatConversation,
  openChatWindow,
  saveChatTurn,
  startChatConversation,
  UnknownConversationError,
} from './ask.history.js'

async function main(): Promise<void> {
  const prisma = getPrisma()
  const user = await prisma.user.create({ data: testUser('ask-history') })
  const other = await prisma.user.create({ data: testUser('ask-history-other') })
  let failed = 0
  const check = (name: string, ok: boolean): void => {
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  }

  try {
    const opened = await openChatWindow(user.id, undefined)
    check('首次打开是空的新对话', opened.messages.length === 0 && opened.conversation.title === '新对话')

    const saved = await saveChatTurn(
      user.id,
      '社区厨余怎么堆肥',
      '可以先分类',
      '检索了堆肥',
      opened.conversation.id,
    )
    check('写入后标题取自第一句提问', saved.conversation.title === '社区厨余怎么堆肥')
    check('一问一答各存一条', saved.messages.length === 2 && saved.messages[1]?.thinking === '检索了堆肥')

    const fresh = await startChatConversation(user.id)
    check(
      '新对话是另一扇空窗口',
      fresh.messages.length === 0 && fresh.conversation.id !== saved.conversation.id,
    )
    check('窗口列表里两轮都在', fresh.conversations.length === 2)

    const again = await startChatConversation(user.id)
    check(
      '已经是空窗口时不再多开一扇',
      again.conversation.id === fresh.conversation.id && again.conversations.length === 2,
    )

    const back = await openChatWindow(user.id, saved.conversation.id)
    check(
      '切回旧窗口还能看到原来的提问',
      back.messages.length === 2 && back.messages[0]?.content === '社区厨余怎么堆肥',
    )

    let blocked = false
    try {
      await clearChatConversation(other.id, saved.conversation.id)
    } catch (err) {
      blocked = err instanceof UnknownConversationError
    }
    check('别的用户清不掉这轮对话', blocked)

    const cleared = await clearChatConversation(user.id, saved.conversation.id)
    check(
      '清空只删当前窗口',
      cleared.conversation.id === saved.conversation.id &&
        cleared.messages.length === 0 &&
        cleared.conversation.title === '新对话',
    )
    const otherWindow = await openChatWindow(user.id, fresh.conversation.id)
    check('另一轮对话还在', otherWindow.conversation.id === fresh.conversation.id)

    await prisma.chatMessage.create({
      data: { userId: user.id, role: 'user', content: '升级前的旧记录', thinking: '' },
    })
    const migrated = await openChatWindow(user.id, undefined)
    check(
      '没有窗口的旧消息会被收进来',
      migrated.messages.some((row) => row.content === '升级前的旧记录'),
    )

    const hidden = await openChatWindow(other.id, undefined)
    check(
      '另一个用户看不到这些对话',
      hidden.messages.length === 0 && hidden.conversations.every((row) => row.id !== fresh.conversation.id),
    )
  } finally {
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.user.delete({ where: { id: other.id } })
    await prisma.$disconnect()
  }

  if (failed > 0) {
    console.error(`ask.history selftest failed: ${failed}`)
    process.exitCode = 1
  }
}

function testUser(prefix: string): {
  readonly name: string
  readonly org: string
  readonly occupation: string
  readonly phone: string
  readonly passwordHash: string
} {
  const suffix = Math.floor(Math.random() * 1_0000_0000)
    .toString()
    .padStart(8, '0')
  return {
    name: prefix,
    org: 'selftest',
    occupation: 'selftest',
    phone: `198${suffix}`,
    passwordHash: 'selftest-not-a-login',
  }
}

void main()
