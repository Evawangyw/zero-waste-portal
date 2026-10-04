// 运维入口：node/tsx 手动跑一次索引同步
// 用法：npm run sync:index --workspace backend
// 输出：一行 JSON（remoteTotal / upserted / localRows / inSync），便于主控直接对账。
import { loadEnvFile, syncIndex } from './index.js'
import { getPrisma } from '../db/prisma.js'

async function main(): Promise<void> {
  loadEnvFile()
  const result = await syncIndex()
  console.log(JSON.stringify(result, null, 2))
  if (!result.inSync) {
    console.error(
      `[sync-index] 对账不一致：本地 ${result.localRows} 行 vs WeKnora total ${result.remoteTotal}`,
    )
    process.exitCode = 1
  }
  await getPrisma().$disconnect()
}

main().catch((err: unknown) => {
  console.error('[sync-index] 失败：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
