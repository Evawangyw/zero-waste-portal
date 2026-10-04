// 运维入口：手动跑一次书架索引同步（清洗 + 元数据解析一并落库）
// 用法：npm run sync:index --workspace backend
// 输出：一行 JSON（remoteTotal / upserted / localRows / inSync），便于主控直接对账。
import { loadEnvFile } from '../../weknora/index.js'
import { getPrisma } from '../../db/prisma.js'
import { syncShelfIndex } from './docs.shelf.sync.js'

async function main(): Promise<void> {
  loadEnvFile()
  const result = await syncShelfIndex()
  console.log(JSON.stringify(result, null, 2))
  if (!result.inSync) {
    console.error(
      `[sync-shelf-index] 对账不一致：本地 ${result.localRows} 行 vs WeKnora total ${result.remoteTotal}`,
    )
    process.exitCode = 1
  }
  await getPrisma().$disconnect()
}

main().catch((err: unknown) => {
  console.error('[sync-shelf-index] 失败：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
