// 运维 CLI（T07）：把某个已注册手机号的账号提为管理员，供 GET /api/admin/stats/summary 放行。
//
// 用法（cwd = backend/）：
//   npm run admin:promote -- 13800000001          # 提为管理员
//   npm run admin:promote -- 13800000001 --revoke # 撤销
//   npm run admin:promote                          # 无参：列出当前管理员
//
// 为什么需要它：P0 的看板守卫是「ADMIN_STATS_TOKEN 静态口令 或 isAdmin 用户 JWT」，
// 而 isAdmin 这列（T00 就建了）此前没有任何写入入口。没有这个 CLI，
// 非命令行方式（浏览器里）就没法拿到第二个可放行路径。
//
// 安全边界：
//  - 只能操作**已注册**的手机号（本 CLI 不建号），避免顺手造出管理员账号；
//  - 只写 users.isAdmin 一列，不碰密码哈希/其它字段；
//  - 无参运行只读不写。
import { loadEnvFile } from '../../weknora/index.js'
import { getPrisma } from '../../db/prisma.js'

async function main(): Promise<void> {
  loadEnvFile()
  const prisma = getPrisma()
  const args = process.argv.slice(2)
  const phone = args.find((value) => /^\d{11}$/.test(value))
  const revoke = args.includes('--revoke')

  if (phone === undefined) {
    const admins = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { phone: true, name: true, org: true },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`[track.admin] 当前管理员 ${admins.length} 人：`)
    for (const admin of admins) {
      console.log(`  - ${admin.phone}  ${admin.name}（${admin.org}）`)
    }
    console.log('用法：npm run admin:promote -- <11位手机号> [--revoke]')
    return
  }

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, isAdmin: true },
  })
  if (user === null) {
    console.error(`[track.admin] 手机号 ${phone} 未注册；本 CLI 不建号，请先走 /api/auth/register`)
    process.exitCode = 1
    return
  }

  const next = !revoke
  if (user.isAdmin === next) {
    console.log(`[track.admin] ${phone} 已经是 isAdmin=${String(next)}，无需改动`)
    return
  }
  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: next } })
  console.log(`[track.admin] ${phone} -> isAdmin=${String(next)}`)
  console.log(
    '提示：拿该账号在 /api/auth/login 换 JWT，带 Authorization 头即可读 /api/admin/stats/summary',
  )
}

main()
  .catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[track.admin] 执行失败：${detail}`)
    process.exitCode = 1
  })
  .finally(() => {
    void getPrisma().$disconnect()
  })
