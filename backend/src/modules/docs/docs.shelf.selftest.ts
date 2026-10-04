// 契约（模块内）：docs.shelf.selftest —— 书架层自测（清洗 + 解析 + 查询）
// 用法：npm run test:shelf --workspace backend
//
// 设计原则（任务卡硬要求）：
//  - **不硬编码库里不存在的值**：所有查询类断言的期望值都从当前 SQLite 索引现场推导
//    （先读真实 distinct 值 / 真实文件名片段，再拿它去筛/去搜），换一批数据照样有效。
//  - 唯一使用合成数据的是「公文清洗」用例 —— 实测库里 42 个文件名全是
//    「省+县.xlsx」这类地名简称，没有公文壳/文号，清洗逻辑不造样本就测不到。
//  - 额外做一条架构断言：查询层不得 import weknora（保证书架不打引擎）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadEnvFile } from '../../weknora/index.js'
import { getPrisma } from '../../db/prisma.js'
import { cleanFileName, parseShelfMetadata } from './docs.shelf.clean.js'
import { parseShelfQuery } from './docs.shelf.router.js'
import { queryFacets, queryShelf } from './docs.shelf.repo.js'
import { MISSING_LABEL } from './docs.shelf.types.js'
import type { ShelfItem, ShelfQuery } from './docs.shelf.types.js'

let passed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail === '' ? '' : ` —— ${detail}`}`)
    console.log(`  FAIL  ${name}${detail === '' ? '' : `  (${detail})`}`)
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

async function main(): Promise<void> {
  loadEnvFile()
  const prisma = getPrisma()

  const rawRows = await prisma.knowledgeIndex.findMany({
    orderBy: { knowledgeId: 'asc' },
  })
  console.log(`索引现场：${rawRows.length} 行`)

  // ================================================================ 1. 清洗单测
  section('1. 文件名清洗（PRD §9.3）')
  const cleanCases: readonly {
    readonly name: string
    readonly raw: string
    readonly want: string
  }[] = [
    {
      name: '公文壳+文号+扩展名 全剥',
      raw: '关于印发《生活垃圾分类工作方案》的通知（X办发〔2024〕15号）.pdf',
      want: '生活垃圾分类工作方案',
    },
    {
      // 注意：外壳是结尾的「的通知」，「试点工作」属标题本体，必须保留（不能贪心剥成「试点」）
      name: '公文壳（无书名号的通知）',
      raw: '关于开展零废弃城市试点工作的通知.docx',
      want: '开展零废弃城市试点工作',
    },
    { name: '公文壳（的函）', raw: '关于餐厨垃圾处理的函.pdf', want: '餐厨垃圾处理' },
    {
      name: '只剥文号（无公文壳）',
      raw: '某某实施方案（发改环资〔2023〕120号）.docx',
      want: '某某实施方案',
    },
    { name: '半角括号文号也剥', raw: '某某方案(X发[2024]3号)', want: '某某方案' },
    {
      name: '无壳无号的普通名不误伤',
      raw: '零废弃知识库建设指南.pdf',
      want: '零废弃知识库建设指南',
    },
    { name: '扩展名正确摘除', raw: '陕西宁陕.xlsx', want: '陕西宁陕' },
    { name: '无扩展名不乱切', raw: '2024年塑料污染治理报告', want: '2024年塑料污染治理报告' },
    { name: '中间的点不当扩展名', raw: '3.5折促销方案.pdf', want: '3.5折促销方案' },
  ]
  for (const c of cleanCases) {
    const got = cleanFileName(c.raw).readableTitle
    check(`清洗：${c.name}`, got === c.want, `期望「${c.want}」实得「${got}」`)
  }
  const idem = cleanFileName(
    cleanFileName('关于印发《A》的通知（X发〔2024〕1号）.pdf').readableTitle,
  )
  check(
    '清洗幂等（对结果再洗一次不变）',
    idem.readableTitle === 'A',
    `实得「${idem.readableTitle}」`,
  )

  // ================================================================ 2. 元数据解析容错
  section('2. custom_metadata 解析（中文字段名 + 空值容错）')
  const meta = (m: unknown): ReturnType<typeof parseShelfMetadata> =>
    parseShelfMetadata(m as Record<string, unknown> | null)
  check(
    'null -> 全空不抛',
    (() => {
      const r = meta(null)
      return r.year === '' && r.org === '' && r.docType === '' && r.topics.length === 0
    })(),
  )
  check('{} -> 全空', meta({}).year === '')
  check('值为 null -> 该维度空串', meta({ 年份: null }).year === '')
  check('值为空白串 -> 该维度空串', meta({ 知识类型: '   ' }).docType === '')
  check('值为数字 -> 转字符串', meta({ 年份: 2026 }).year === '2026')
  check(
    '知识领域顿号分隔 -> 多主题',
    JSON.stringify(meta({ 知识领域: '塑料污染、食物浪费' }).topics) === '["塑料污染","食物浪费"]',
  )
  check(
    '知识领域已是数组 -> 原样取',
    JSON.stringify(meta({ 知识领域: ['a', 'b'] }).topics) === '["a","b"]',
  )
  check('主题去重保序', JSON.stringify(meta({ 知识领域: 'a,a,b' }).topics) === '["a","b"]')
  check(
    '四个中文字段名各自落位',
    (() => {
      const r = meta({ 年份: '2026', 知识类型: 'X', 知识领域: 'D', 知识发布机构: 'O' })
      return r.year === '2026' && r.docType === 'X' && r.org === 'O' && r.topics[0] === 'D'
    })(),
  )

  // ================================================================ 3. 真实数据不变量
  section('3. 索引真实数据不变量')
  check(
    '每行 fileName 非空（搜索字段不能空）',
    rawRows.every((r) => r.fileName.trim() !== ''),
    `空 fileName ${rawRows.filter((r) => r.fileName.trim() === '').length} 行`,
  )
  check(
    '每行 readableTitle 非空（清洗有产出/已回落）',
    rawRows.every((r) => r.readableTitle.trim() !== ''),
  )
  check(
    '每行 customMetadata 是合法 JSON',
    rawRows.every((r) => {
      try {
        return typeof JSON.parse(r.customMetadata) === 'object'
      } catch {
        return false
      }
    }),
  )
  check(
    '每行 topics 是合法 JSON 数组',
    rawRows.every((r) => Array.isArray(safeParse(r.topics))),
  )

  // ================================================================ 4. 架构断言
  section('4. 架构：查询层不打 WeKnora')
  const here = dirname(fileURLToPath(import.meta.url))
  const repoSrc = readFileSync(resolve(here, 'docs.shelf.repo.ts'), 'utf8')
  const routerSrc = readFileSync(resolve(here, 'docs.shelf.router.ts'), 'utf8')
  check('docs.shelf.repo.ts 不 import weknora 对接层', !/from\s+['"][^'"]*weknora/.test(repoSrc))
  check(
    'docs.shelf.router.ts 不 new WeKnoraClient',
    !/new WeKnoraClient/.test(routerSrc) && !/WeKnoraClient\.fromEnv/.test(routerSrc),
  )

  // ================================================================ 5. 查询层（期望值全部现场推导）
  section('5. 书架查询（SQLite，不打引擎）')

  const all = await queryShelf(prisma, baseQuery())
  console.log(
    `  · 全量 total=${all.total} pageSize=${all.pageSize} zeroResult=${all.zeroResult} totalPages=${all.totalPages}`,
  )
  check(
    '默认 total 等于索引行数',
    all.total === rawRows.length,
    `${all.total} vs ${rawRows.length}`,
  )
  const defaults = parseShelfQuery(new URLSearchParams())
  const defaultRes = await queryShelf(prisma, defaults)
  check('默认分页 20/页（未传参时）', defaults.pageSize === 20, String(defaults.pageSize))
  check('默认页真的只回 20 条', defaultRes.items.length === 20, String(defaultRes.items.length))
  check('默认页 total 是全量 42（不受分页影响）', defaultRes.total === rawRows.length)
  check('默认排序为 year_desc', all.sort === 'year_desc', all.sort)
  check('默认 sort 即年份倒序（缺年份沉底）', missingYearsAreLast(all.items), orderDump(all.items))
  check('totalPages 算对', all.totalPages === Math.ceil(all.total / all.pageSize))
  // 年份单调性（仅当库里真有 >=2 个不同年份才有意义，否则跳过并说明）
  const years = distinct(all.items.map((i) => i.year))
  if (years.filter((y) => y !== MISSING_LABEL).length >= 2) {
    const desc = all.items.filter((i) => i.year !== MISSING_LABEL).map((i) => Number(i.year))
    check(
      '年份倒序单调不增',
      desc.every((y, i) => i === 0 || (desc[i - 1] ?? Number.POSITIVE_INFINITY) >= y),
      desc.join(','),
    )
  } else {
    console.log(
      `  SKIP  年份倒序单调性（库里只有 ${years.filter((y) => y !== MISSING_LABEL).length} 个年份，样本不足）`,
    )
  }
  const asc = await queryShelf(prisma, { ...baseQuery(), sort: 'year_asc', pageSize: 100 })
  check('year_asc 同样把缺年份沉底', missingYearsAreLast(asc.items), orderDump(asc.items))

  // ---- 5.1 文件名搜索：用库里真实文件名片段 ----
  const sample = rawRows.find((r) => r.fileName.length >= 4)
  if (sample !== undefined) {
    const frag = sample.fileName.slice(0, 3)
    const hit = await queryShelf(prisma, { ...baseQuery(), q: frag })
    console.log(`  · q="${frag}" -> total=${hit.total} zeroResult=${hit.zeroResult}`)
    check('q=真实文件名片段有命中', hit.total > 0 && hit.zeroResult === false)
    check(
      'q=命中项确实含该片段（fileName 或可读标题）',
      hit.items.every((i) => i.fileName.includes(frag) || i.readableTitle.includes(frag)),
    )
    const miss = await queryShelf(prisma, { ...baseQuery(), q: 'zzz查无此词zzz' })
    console.log(`  · q="zzz查无此词zzz" -> total=${miss.total} zeroResult=${miss.zeroResult}`)
    check(
      'q=不存在的词 -> total 0 且 zeroResult:true',
      miss.total === 0 && miss.zeroResult === true,
    )
    check('q=不存在的词 -> items 为空数组', Array.isArray(miss.items) && miss.items.length === 0)
    // q 与筛选叠加（跨维度与）
    if (hit.items.length > 0) {
      const hitType = hit.items[0]?.docType ?? MISSING_LABEL
      const combo = await queryShelf(prisma, { ...baseQuery(), q: frag, types: [hitType] })
      check(
        'q= 与维度筛选叠加后是子集（且）',
        combo.total <= hit.total && combo.items.every((i) => i.docType === hitType),
        `${combo.total} <= ${hit.total}`,
      )
    }
  }

  // ---- 5.2 维度筛选：值全部取自 facets（= 库里真实值） ----
  const facets = await queryFacets(prisma, undefined)
  console.log(
    `  · facets types=${JSON.stringify(facets.types)} orgs=${JSON.stringify(facets.orgs)} years=${JSON.stringify(facets.years)} tags=${JSON.stringify(facets.tags)}`,
  )
  check('facets total 等于索引行数', facets.total === rawRows.length)
  check(
    'facets 各维度计数之和等于 total',
    ['types', 'orgs', 'years'].every((k) => {
      const list = facets[k as 'types' | 'orgs' | 'years']
      return list.reduce((s, f) => s + f.count, 0) === facets.total
    }),
  )

  for (const [dim, list] of [
    ['type', facets.types],
    ['org', facets.orgs],
    ['year', facets.years],
  ] as const) {
    for (const facet of list) {
      const res = await queryShelf(prisma, {
        ...baseQuery(),
        [DIM_QUERY_FIELD[dim]]: [facet.value],
      })
      const itemKey = DIM_ITEM_FIELD[dim]
      const ok = res.total === facet.count && res.items.every((i) => i[itemKey] === facet.value)
      check(
        `筛选 ${dim}=${facet.value} 计数与 facets 一致且逐项匹配`,
        ok,
        `筛出 ${res.total}，facets 记 ${facet.count}`,
      )
    }
  }

  // ---- 5.3 同维度多选=或；跨维度=与 ----
  if (facets.types.length >= 2) {
    const [a, b] = [facets.types[0], facets.types[1]]
    if (a !== undefined && b !== undefined) {
      const either = await queryShelf(prisma, { ...baseQuery(), types: [a.value, b.value] })
      check(
        `同维度多选是「或」(${a.value} ${b.value})`,
        either.total === a.count + b.count,
        `${either.total} vs ${a.count}+${b.count}`,
      )
      if (facets.orgs.length >= 1 && facets.years.length >= 1) {
        const org = facets.orgs[0]
        const yr = facets.years[0]
        if (org !== undefined && yr !== undefined) {
          const both = await queryShelf(prisma, {
            ...baseQuery(),
            types: [a.value, b.value],
            orgs: [org.value],
            years: [yr.value],
          })
          check(
            '跨维度是「与」（三维度同时筛，结果不超单维度）',
            both.total <= either.total && both.total <= org.count,
            `${both.total} <= ${either.total} / ${org.count}`,
          )
        }
      }
    }
  } else {
    console.log('  SKIP  多选「或」/跨维度「与」（该维度真实取值不足 2 个）')
  }

  // ---- 5.4 「未标注」哨兵 ----
  const missingType = await queryShelf(prisma, { ...baseQuery(), types: [MISSING_LABEL] })
  const rawEmptyType = rawRows.filter((r) => r.docType === '').length
  check(
    `筛 ${MISSING_LABEL} = 该维度为空（不打死过滤）`,
    missingType.total === rawEmptyType && missingType.total > 0,
    `${missingType.total} vs 库内空值 ${rawEmptyType}`,
  )
  check(
    '筛 未标注 的每项都无该维度值',
    missingType.items.every((i) => i[DIM_ITEM_FIELD.type] === MISSING_LABEL),
  )

  // ---- 5.5 主题多选（库里 topics 全空也要保证不 500、结果正确） ----
  const tagged = await queryShelf(prisma, { ...baseQuery(), tags: ['塑料污染'] })
  check(
    'tag= 不存在的词 -> zeroResult:true（不报错）',
    tagged.zeroResult === true && tagged.total === 0,
    `total=${tagged.total}`,
  )
  const tagMissing = await queryShelf(prisma, { ...baseQuery(), tags: [MISSING_LABEL] })
  check(
    `tag=${MISSING_LABEL} -> 无主题的条数`,
    tagMissing.total === rawRows.filter((r) => r.topics === '[]').length,
    `${tagMissing.total}`,
  )

  // ---- 5.6 分页 ----
  const page1 = await queryShelf(prisma, { ...parseShelfQuery(new URLSearchParams()), page: 1 })
  const page2 = await queryShelf(prisma, { ...parseShelfQuery(new URLSearchParams()), page: 2 })
  check('第 1 页 20 条', page1.items.length === Math.min(20, all.total))
  check(
    '分页不重复',
    new Set([...page1.items, ...page2.items].map((i) => i.id)).size ===
      page1.items.length + page2.items.length,
  )
  const page999 = await queryShelf(prisma, { ...baseQuery(), page: 999 })
  check('越界页返回空 + zeroResult', page999.items.length === 0 && page999.zeroResult === true)

  // ---- 5.7 参数健壮性：非法输入不 400、不炸 ----
  const weird = parseShelfQuery(
    new URLSearchParams('page=abc&pageSize=-5&sort=drop_table&type=&q=&tag=,,,'),
  )
  check('非法 page 回落 1', weird.page === 1)
  check('非法 pageSize 回落 20', weird.pageSize === 20)
  check('非法 sort 回落 year_desc', weird.sort === 'year_desc')
  check('空 type/q 被折叠掉', weird.types.length === 0 && weird.q === null)
  const weirdRes = await queryShelf(prisma, weird)
  check('非法参数查询仍能正常返回', weirdRes.success === true)

  await prisma.$disconnect()

  // ================================================================ 汇总
  console.log(`\n${'='.repeat(60)}`)
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项`)
  if (failures.length > 0) {
    console.log('\n失败清单：')
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  } else {
    console.log('全部通过')
  }
}

// ------------------------------------------------------------------ 工具

/** 默认查询：不限库、每页 100（自测要全量翻） */
function baseQuery(): ShelfQuery {
  return { ...parseShelfQuery(new URLSearchParams()), pageSize: 100 }
}

/** 缺年份必须全部沉底（year_desc / year_asc 都要满足） */
function missingYearsAreLast(items: readonly ShelfItem[]): boolean {
  let seenMissing = false
  for (const item of items) {
    const missing = item.year === MISSING_LABEL
    if (missing) seenMissing = true
    else if (seenMissing) return false
  }
  return true
}

function orderDump(items: readonly ShelfItem[]): string {
  return items
    .slice(0, 6)
    .map((i) => `${i.year}:${i.title.slice(0, 12)}`)
    .join(' | ')
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** 查询参数名 -> ShelfQuery 字段名（注意是复数，别写成 type/org/year） */
const DIM_QUERY_FIELD = {
  type: 'types',
  org: 'orgs',
  year: 'years',
} as const satisfies Record<'type' | 'org' | 'year', keyof ShelfQuery>

/** 查询参数名 -> ShelfItem 字段名 */
const DIM_ITEM_FIELD = {
  type: 'docType',
  org: 'org',
  year: 'year',
} as const satisfies Record<'type' | 'org' | 'year', keyof ShelfItem>

main().catch((err: unknown) => {
  console.error('[selftest] 崩溃：', err)
  process.exitCode = 1
})
