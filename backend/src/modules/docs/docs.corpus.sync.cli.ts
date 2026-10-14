// 用法：npm run sync:corpus --workspace backend
// 把 knowledge_index 换成复现包里有 Markdown 的文档，并按文件名接上本机原文。
import { loadEnvFile } from '../../weknora/index.js'
import { getPrisma } from '../../db/prisma.js'
import { syncCorpusShelf } from './docs.corpus.sync.js'

async function main(): Promise<void> {
  loadEnvFile()
  const result = await syncCorpusShelf()
  console.log(JSON.stringify(result, null, 2))
  await getPrisma().$disconnect()
}

main().catch((err: unknown) => {
  console.error('[sync-corpus-shelf] 失败：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
