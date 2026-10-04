// 一次性对账脚本（不进仓库产物，供主控验收取证用；用完可删）
// 目的：绕过 sync-index 自己的返回值，直接查 SQLite 原始行数与内容。
import { loadEnvFile } from '../weknora/index.js'
import { getPrisma } from './prisma.js'

async function main(): Promise<void> {
  loadEnvFile()
  const prisma = getPrisma()
  const total = await prisma.knowledgeIndex.count()
  const byKb = await prisma.knowledgeIndex.groupBy({ by: ['knowledgeBaseId'], _count: true })
  const sample = await prisma.knowledgeIndex.findFirst({ orderBy: { title: 'asc' } })
  const rawRows = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM knowledge_index')
  const nonEmptyMeta = await prisma.knowledgeIndex.findMany({
    where: { NOT: { customMetadata: '{}' } },
    select: { title: true, customMetadata: true },
  })
  console.log(
    JSON.stringify(
      {
        rawSqlCount: Number(rawRows[0]?.n ?? -1),
        prismaCount: total,
        nonEmptyCustomMetadata: nonEmptyMeta.length,
        nonEmptySamples: nonEmptyMeta.slice(0, 3).map((m) => ({
          title: m.title,
          customMetadata: JSON.parse(m.customMetadata) as unknown,
        })),
        groupBy: byKb.map((g) => ({ kb: g.knowledgeBaseId, count: g._count })),
        sample: sample === null ? null : {
          knowledgeId: sample.knowledgeId,
          title: sample.title,
          customMetadata: JSON.parse(sample.customMetadata) as unknown,
          tags: JSON.parse(sample.tags) as unknown,
          sourceUpdatedAt: sample.sourceUpdatedAt,
        },
      },
      null,
      2,
    ),
  )
  await prisma.$disconnect()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
