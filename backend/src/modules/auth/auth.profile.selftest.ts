// 验收：普通用户只能看到自己的提问和下载；管理员不能打开个人主页；回答按时间配到对应提问。
// 跑完删除自己建的测试用户。
import { getPrisma } from '../../db/prisma.js'
import { pairProfileQuestions, loadProfileHome } from './auth.profile.js'
import { AuthError } from './auth.service.js'

async function main(): Promise<void> {
  const prisma = getPrisma()
  const user = await prisma.user.create({ data: testUser('profile-user', false) })
  const other = await prisma.user.create({ data: testUser('profile-other', false) })
  const admin = await prisma.user.create({ data: testUser('profile-admin', true) })
  let failed = 0
  const check = (name: string, ok: boolean): void => {
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  }

  try {
    const paired = pairProfileQuestions(
      [
        row('q1', 'user', '第一问', '2026-01-01T00:00:00.000Z'),
        row('a1', 'assistant', '第一答', '2026-01-01T00:00:01.000Z'),
        row('q2', 'user', '第二问', '2026-01-01T00:00:02.000Z'),
      ],
      50,
    )
    check('最新的提问排在前面', paired[0]?.question === '第二问' && paired[0]?.answer === '')
    check('回答配到前一条提问', paired[1]?.question === '第一问' && paired[1]?.answer === '第一答')

    const t0 = new Date('2026-02-01T00:00:00.000Z')
    const t1 = new Date('2026-02-01T00:00:01.000Z')
    const t2 = new Date('2026-02-02T00:00:00.000Z')
    await prisma.chatMessage.create({
      data: { id: `q-${user.id}`, userId: user.id, role: 'user', content: '我的问题', createdAt: t0 },
    })
    await prisma.chatMessage.create({
      data: {
        id: `a-${user.id}`,
        userId: user.id,
        role: 'assistant',
        content: '我的回答',
        createdAt: t1,
      },
    })
    await prisma.chatMessage.create({
      data: {
        id: `o-${other.id}`,
        userId: other.id,
        role: 'user',
        content: '别人的问题',
        createdAt: t2,
      },
    })
    await prisma.downloadLog.create({
      data: {
        id: `d-${user.id}`,
        userId: user.id,
        docId: 'doc-self',
        docTitle: '我的下载',
        fileName: '我的下载.pdf',
        createdAt: t2,
      },
    })
    await prisma.downloadLog.create({
      data: {
        id: `d-${other.id}`,
        userId: other.id,
        docId: 'doc-other',
        docTitle: '别人的下载',
        fileName: '别人的下载.pdf',
        createdAt: t2,
      },
    })

    const home = await loadProfileHome(user.id)
    const dumped = JSON.stringify(home)
    check('不回传密码哈希', !dumped.includes('passwordHash'))
    check('只看到自己的提问', home.questionTotal === 1 && home.questions[0]?.answer === '我的回答')
    check('只看到自己的下载', home.downloadTotal === 1 && home.downloads[0]?.docTitle === '我的下载')

    let adminBlocked = false
    try {
      await loadProfileHome(admin.id)
    } catch (err) {
      adminBlocked = err instanceof AuthError && err.code === 'NOT_FOR_ADMIN' && err.status === 403
    }
    check('管理员不能打开个人主页', adminBlocked)
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id, admin.id] } } })
    await prisma.$disconnect()
  }

  if (failed > 0) {
    console.error(`auth.profile selftest failed: ${failed}`)
    process.exitCode = 1
  }
}

function row(id: string, role: string, content: string, iso: string) {
  return { id, role, content, createdAt: new Date(iso) }
}

function testUser(prefix: string, isAdmin: boolean) {
  const suffix = Math.floor(Math.random() * 1_0000_0000)
    .toString()
    .padStart(8, '0')
  return {
    name: prefix,
    org: 'selftest',
    occupation: 'selftest',
    phone: `197${suffix}`,
    passwordHash: 'selftest-not-a-login',
    isAdmin,
  }
}

void main()
