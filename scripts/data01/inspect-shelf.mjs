// DATA01 辅助：对比本地 KnowledgeIndex 与 WeKnora 真实条目，查「远端已删、本地残留」的脏行。
// 用途：syncIndex 只做 upsert 不做 delete，清库后本地索引会留残行，
// 这条脚本给出可复核的证据（残行数 + 样本），供主控判断是否要补 purge。
// 读操作，不改任何数据。
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function loadEnv() {
  const out = {}
  for (const line of readFileSync(resolve(ROOT, 'backend', '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m !== null) out[m[1]] = m[2]
  }
  return out
}

const env = loadEnv()
const kbId = process.argv[2] ?? env.WEKNORA_KB_ID
const prisma = new PrismaClient({ datasources: { db: { url: env.DB_URL } } })

const r = await fetch(
  `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${kbId}/knowledge?page=1&page_size=200`,
  { headers: { 'X-API-Key': env.WEKNORA_API_KEY } },
)
const j = await r.json()
const remoteIds = new Set((j.data ?? []).map((x) => x.id))

const rows = await prisma.knowledgeIndex.findMany({ where: { knowledgeBaseId: kbId } })
const stale = rows.filter((x) => !remoteIds.has(x.knowledgeId))

console.log(`目标库          = ${kbId}`)
console.log(`WeKnora 条目数  = ${remoteIds.size}`)
console.log(`本地索引行数    = ${rows.length}`)
console.log(`远端已不存在    = ${stale.length} 条（脏行）`)
console.log('\n--- 脏行样本（最多 12 条）---')
for (const s of stale.slice(0, 12)) {
  console.log(
    `  ${s.knowledgeId.slice(0, 8)}  syncedAt=${s.syncedAt.toISOString()}  ${(s.readableTitle || s.fileName || '').slice(0, 46)}`,
  )
}
console.log('\n--- 本地索引按库分布 ---')
const groups = await prisma.knowledgeIndex.groupBy({
  by: ['knowledgeBaseId'],
  _count: { _all: true },
})
for (const g of groups) console.log(`  ${g.knowledgeBaseId}  ${g._count._all} 行`)

await prisma.$disconnect()
