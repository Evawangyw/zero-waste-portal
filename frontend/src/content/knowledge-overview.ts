/**
 * 知识库介绍用的静态快照。
 *
 * 来源：钉钉多维表「零废弃知识库」的「知识总览」看板（上次编辑 2026-09-28）。
 * 这里不接实时接口。看板改数之后，要一起改这份快照和 selftest 里的合计。
 *
 * 年份只收录看板上能读出的柱，柱上数字合计不等于零废弃总数，介绍页不把差额解释成别的口径。
 */

export interface OverviewCount {
  readonly name: string
  readonly count: number
}

export interface OverviewYear {
  readonly year: string
  readonly count: number
}

/** 看板标注的上次编辑日 */
export const OVERVIEW_AS_OF = '2026-09-28'

export const ZERO_WASTE_TOTAL = 481

export const CHEMICAL_TOTAL = 125

/** 零废弃议题领域。按条数从高到低，合计等于 ZERO_WASTE_TOTAL。 */
export const ZERO_WASTE_TOPICS: readonly OverviewCount[] = [
  { name: '塑料', count: 99 },
  { name: '垃圾分类', count: 72 },
  { name: '禁塑', count: 37 },
  { name: '甲烷', count: 36 },
  { name: '包装', count: 36 },
  { name: '零废弃', count: 33 },
  { name: '废弃物管理', count: 30 },
  { name: '无废城市', count: 29 },
  { name: '食物/有机废弃物', count: 20 },
  { name: 'EPR', count: 19 },
  { name: '再生资源', count: 17 },
  { name: '循环经济', count: 15 },
  { name: '电商废弃物', count: 14 },
  { name: '其他', count: 14 },
  { name: '行业发展', count: 4 },
  { name: '环保大类', count: 4 },
  { name: '低值可回收物', count: 2 },
]

/** 零废弃知识类型。合计等于 ZERO_WASTE_TOTAL。 */
export const ZERO_WASTE_TYPES: readonly OverviewCount[] = [
  { name: '政策法规', count: 218 },
  { name: '研究报告', count: 189 },
  { name: '案例工具', count: 51 },
  { name: '各类标准', count: 23 },
]

/**
 * 零废弃不同年份的知识数量（看板柱上的数字）。
 * 2006–2011 看板上没有柱。
 */
export const ZERO_WASTE_YEARS: readonly OverviewYear[] = [
  { year: '2001', count: 1 },
  { year: '2002', count: 1 },
  { year: '2003', count: 2 },
  { year: '2004', count: 3 },
  { year: '2005', count: 1 },
  { year: '2012', count: 1 },
  { year: '2013', count: 3 },
  { year: '2014', count: 2 },
  { year: '2015', count: 6 },
  { year: '2016', count: 9 },
  { year: '2017', count: 11 },
  { year: '2018', count: 17 },
  { year: '2019', count: 32 },
  { year: '2020', count: 74 },
  { year: '2021', count: 58 },
  { year: '2022', count: 56 },
  { year: '2023', count: 52 },
  { year: '2024', count: 62 },
  { year: '2025', count: 48 },
  { year: '2026', count: 29 },
  { year: '远期', count: 1 },
]

/** 化学品知识类型。合计等于 CHEMICAL_TOTAL。 */
export const CHEMICAL_TYPES: readonly OverviewCount[] = [
  { name: '研究实践报告', count: 62 },
  { name: '各类标准', count: 31 },
  { name: '国内政策法规', count: 18 },
  { name: '国际公约', count: 12 },
  { name: '科学认知', count: 2 },
]

export function shareLabel(count: number, total: number): string {
  if (total <= 0) return '0%'
  return `${((count / total) * 100).toFixed(1)}%`
}
