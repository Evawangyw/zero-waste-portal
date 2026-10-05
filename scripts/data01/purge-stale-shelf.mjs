// DATA01：清除本地书架索引里「WeKnora 侧已不存在」的脏行（purge stale index rows）
//
// 为什么需要（DATA01 立卡原因 + 验收标准②）：
//   syncIndex() 只做 upsert 不做 delete。小志把「111」库的私人文件清零后，
//   本地 KnowledgeIndex 仍残留 42 行旧条目（陕西宁陕/重庆城口/贵州榕江…），
//   书架页照样会把这些私人标题渲染出来 —— 既对不上账，也踩红线。
//   故在灌完公开资料后按「远端实存」口径清一次，再跑 syncIndex 对账。
//
// 边界（严守）：
//   - 只删 knowledgeBaseId === 目标库 且 远端列表里不存在的行；
//   - 目标库必须显式传（不给默认值），绝不误删别的库；
//   - 默认 --dry-run，只报告不删；加 --purge 才真删。
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

function parseArgs(argv) {
  let kbId = ''
  let purge = false
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--kb') {
      kbId = argv[i + 1] ?? ''
      i += 1
    } else if (a === '--purge') {
      purge = true
    } else {
      throw new Error(`未知参数 ${a}\n用法：--kb <知识库ID> [--purge]（默认只报告不删）`)
    }
  }
  if (kbId === '') throw new Error('必须显式传 --kb <知识库ID>（不给默认值，避免误删别的库）')
  return { kbId, purge }
}

const env = loadEnv()
const { kbId, purge } = parseArgs(process.argv.slice(2))
const prisma = new PrismaClient({ datasources: { db: { url: env.DB_URL } } })

const r = await fetch(
  `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${kbId}/knowledge?page=1&page_size=200`,
  { headers: { 'X-API-Key': env.WEKNORA_API_KEY } },
)
if (!r.ok) throw new Error(`拉取 WeKnora 列表失败：HTTP ${r.status}`)
const j = await r.json()
const remoteIds = new Set((j.data ?? []).map((x) => x.id))

const rows = await prisma.knowledgeIndex.findMany({ where: { knowledgeBaseId: kbId } })
const stale = rows.filter((x) => !remoteIds.has(x.knowledgeId))

console.log(`[purge-stale] 目标库=${kbId}`)
console.log(
  `[purge-stale] WeKnora 实存=${remoteIds.size} ｜ 本地索引=${rows.length} ｜ 待清脏行=${stale.length}`,
)
console.log(`[purge-stale] 模式=${purge ? '真删(--purge)' : '演练(dry-run，未删除)'}`)

if (stale.length === 0) {
  console.log('[purge-stale] 无脏行，无需处理')
} else if (!purge) {
  console.log('[purge-stale] 待删清单（最多 20 条）：')
  for (const s of stale.slice(0, 20)) {
    console.log(`  ${s.knowledgeId}  ${(s.readableTitle || s.fileName || '').slice(0, 46)}`)
  }
  console.log('[purge-stale] 加 --purge 执行删除')
} else {
  const res = await prisma.knowledgeIndex.deleteMany({
    where: { knowledgeBaseId: kbId, knowledgeId: { notIn: [...remoteIds] } },
  })
  console.log(`[purge-stale] 已删除 ${res.count} 条脏行`)
}

const after = await prisma.knowledgeIndex.count({ where: { knowledgeBaseId: kbId } })
console.log(
  `[purge-stale] 处理后本地索引行数=${after} ｜ 远端实存=${remoteIds.size} ｜ inSync=${after === remoteIds.size}`,
)
await prisma.$disconnect()
