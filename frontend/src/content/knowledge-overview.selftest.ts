/**
 * 验收：快照内部合计必须和看板上的总数一致。
 * 运行：npm run check:overview
 */
import {
  CHEMICAL_TOTAL,
  CHEMICAL_TYPES,
  ZERO_WASTE_TOPICS,
  ZERO_WASTE_TOTAL,
  ZERO_WASTE_TYPES,
  ZERO_WASTE_YEARS,
} from './knowledge-overview.ts'

function sumCounts(items: readonly { count: number }[]): number {
  return items.reduce((total, item) => total + item.count, 0)
}

const checks: ReadonlyArray<readonly [string, boolean]> = [
  ['零废弃议题合计', sumCounts(ZERO_WASTE_TOPICS) === ZERO_WASTE_TOTAL],
  ['零废弃类型合计', sumCounts(ZERO_WASTE_TYPES) === ZERO_WASTE_TOTAL],
  ['化学品类型合计', sumCounts(CHEMICAL_TYPES) === CHEMICAL_TOTAL],
  ['年份柱都有正数', ZERO_WASTE_YEARS.every((item) => item.count > 0)],
  ['年份含 2020 峰值 74', ZERO_WASTE_YEARS.some((item) => item.year === '2020' && item.count === 74)],
]

let failed = 0
for (const [label, ok] of checks) {
  if (ok) {
    console.log(`ok  ${label}`)
  } else {
    failed += 1
    console.error(`fail  ${label}`)
  }
}

if (failed > 0) {
  process.exitCode = 1
}
