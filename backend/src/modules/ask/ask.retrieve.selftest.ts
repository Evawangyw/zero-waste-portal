// 验收：BM25 能把含问句的切片排到前面；两路名次融合不要求分数同一量纲。
import { BM25Index } from './ask.bm25.js'
import { fuseRanks } from './ask.fusion.js'

function check(name: string, ok: boolean, failed: { n: number }): void {
  if (!ok) failed.n += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}

function main(): void {
  const failed = { n: 0 }
  const index = new BM25Index()
  index.add(1, '上海市实行生活垃圾分类制度，单位和个人应当分类投放生活垃圾。')
  index.add(2, '快递包装空隙率应符合限制过度包装的要求。')
  const hits = index.search('上海生活垃圾怎么分类投放', 2)
  check('问上海时第一条是上海条例切片', hits[0]?.id === 1, failed)
  check('无关切片不会排到前面', hits[0]?.id !== 2, failed)

  const fused = fuseRanks(
    [
      [10, 20],
      [20, 30],
    ],
    3,
  )
  check('两路都出现的切片排在只出现一次的前面', fused[0]?.id === 20, failed)
  check('只在向量路出现的切片仍被保留', fused.some((item) => item.id === 30), failed)

  if (failed.n > 0) {
    console.error(`失败 ${failed.n} 项`)
    process.exit(1)
  }
  console.log('ask.retrieve 自测通过')
}

main()
