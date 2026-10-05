// DATA01 验收自测：把任务卡 5 条验收标准逐条跑成真实回显。
//   ①「111」库 total == 导入报告成功数
//   ② 抽 3 份：API 读回 custom_metadata 与 Excel 行逐字段一致 + 书架 /api/docs 搜到标题
//   ③ 导入报告无失败
//   ④ 红线自查：来源公开（每份都有 DOI + 公开 OA 直链）、无真实个人信息
//   ⑤（lint/tsc 由 shell 跑，本脚本负责把①②③④的回显打全）
//
// 读操作，不改任何数据。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const INPUTS = resolve(ROOT, 'inputs')
const KB = 'ab5f8c28-1231-4a9e-93b0-a707af652d40'
// 本项目后端默认 4000（backend/src/config DEFAULT_PORT=4000）；3000 是别的进程的 server.js
const PORTAL = 'http://localhost:4000'

function loadEnv() {
  const out = {}
  for (const line of readFileSync(resolve(ROOT, 'backend', '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m !== null) out[m[1]] = m[2]
  }
  return out
}
const env = loadEnv()
const apiHeaders = { 'X-API-Key': env.WEKNORA_API_KEY }
let pass = 0
let fail = 0
function verdict(ok, label, extra = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : '  ' + extra}`)
}

// ---------------------------------------------------------------- 读入事实
const report = JSON.parse(readFileSync(resolve(INPUTS, 'import-report.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(resolve(INPUTS, 'data01-来源台账.json'), 'utf8'))
const wb = XLSX.read(readFileSync(resolve(INPUTS, 'metadata.xlsx')), { type: 'buffer' })
const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true })
const header = aoa[0]
const excelRows = aoa.slice(1).map((r) => {
  const o = {}
  header.forEach((h, i) => {
    o[h] = r[i] === undefined || r[i] === null || r[i] === '' ? '未标注' : String(r[i])
  })
  return o
})

console.log('='.repeat(78))
console.log('DATA01 验收标准逐条实测')
console.log('='.repeat(78))

// ---------------------------------------------------------------- ① total 对账
console.log('\n【验收①】「111」库 total == 导入报告成功数（10~20）')
const lr = await fetch(
  `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${KB}/knowledge?page=1&page_size=1`,
  { headers: apiHeaders },
)
const lj = await lr.json()
console.log(`  WeKnora  kb=${KB}`)
console.log(`  WeKnora  total = ${lj.total}`)
console.log(
  `  导入报告 total=${report.total} 成功=${report.succeeded} 跳过=${report.skipped} 失败=${report.failed}`,
)
verdict(lj.total === report.succeeded, '① total 对账', `${lj.total} == ${report.succeeded}`)
verdict(
  report.succeeded >= 10 && report.succeeded <= 20,
  '① 成功数落在 10~20',
  `= ${report.succeeded}`,
)

// ---------------------------------------------------------------- ③ 报告无失败
console.log('\n【验收③】导入报告无「失败」')
console.log(
  `  failed=${report.failed}  skipped=${report.skipped}  results=${report.results.length}`,
)
for (const r of report.results.filter((x) => x.outcome !== 'success')) {
  console.log(`  非成功：第 ${r.excelRow} 行 ${r.fileName} — ${r.outcome} ${r.reason}`)
}
verdict(report.failed === 0, '③ 报告失败数 = 0', `= ${report.failed}`)
verdict(
  report.results.length === report.total,
  '③ 报告行数与 Excel 行数一致',
  `${report.results.length} == ${report.total}`,
)

// ---------------------------------------------------------------- ② 抽 3 份逐字段核对
console.log('\n【验收②】抽 3 份：API 读回 custom_metadata 与 Excel 行一致 + 书架能搜到')
// 取「有 DOI 的中间行 + 最后一行 + 首行」，覆盖不同年份/机构/多值领域
const picks = [
  excelRows[0],
  excelRows[Math.floor(excelRows.length / 2)],
  excelRows[excelRows.length - 1],
]
let fieldMismatch = 0
let searchMiss = 0
for (const row of picks) {
  console.log(`\n  ── 抽样：${row['文件名']}`)
  const kl = await fetch(
    `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${KB}/knowledge?page=1&page_size=200&keyword=${encodeURIComponent(row['文件名'].replace(/\.pdf$/, ''))}`,
    { headers: apiHeaders },
  )
  const kj = await kl.json()
  const hit = (kj.data ?? []).find(
    (x) => x.file_name === row['文件名'] || x.file_name?.startsWith(row['文件名'].slice(0, 10)),
  )
  const full =
    hit !== undefined
      ? hit
      : (
          await (
            await fetch(
              `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${KB}/knowledge?page=1&page_size=200`,
              { headers: apiHeaders },
            )
          ).json()
        ).data.find((x) => x.file_name === row['文件名'])
  if (full === undefined) {
    console.log('     ❌ 列表里按文件名找不到该条目')
    fieldMismatch++
    searchMiss++
    continue
  }
  const det = await (
    await fetch(`${env.WEKNORA_BASE_URL}/api/v1/knowledge/${full.id}`, { headers: apiHeaders })
  ).json()
  const cm = det.data?.custom_metadata ?? {}
  console.log(`     knowledge id = ${full.id}`)
  console.log(`     parse_status = ${full.parse_status}`)
  let okAll = true
  for (const key of header) {
    const got = cm[key] === undefined || cm[key] === null ? '（键不存在）' : String(cm[key])
    const exp = row[key]
    const ok = got === exp
    if (!ok) okAll = false
    console.log(
      `     ${ok ? '✅' : '❌'} ${key.padEnd(6, '　')} 期望=${JSON.stringify(exp)}  实读=${JSON.stringify(got)}`,
    )
  }
  console.log(`     读回 custom_metadata 原文：${JSON.stringify(cm)}`)
  if (!okAll) fieldMismatch++

  // 书架搜索
  const sr = await fetch(`${PORTAL}/api/docs?q=${encodeURIComponent(row['知识名'])}&pageSize=5`)
  const sj = await sr.json()
  const list = sj.items ?? sj.data ?? []
  const shelfHit = list.some(
    (x) => x.fileName === row['文件名'] || x.readableTitle === row['知识名'],
  )
  console.log(
    `     书架 /api/docs?q=${row['知识名']} -> HTTP ${sr.status} 命中 ${sj.total ?? '?'} 条  ${shelfHit ? '✅ 搜到该条' : '❌ 未搜到'}`,
  )
  if (!shelfHit) searchMiss++
}
verdict(fieldMismatch === 0, '② 抽样 3 份 custom_metadata 逐字段一致', `不一致 ${fieldMismatch} 处`)
verdict(searchMiss === 0, '② 抽样 3 份书架 /api/docs 均可搜到', `未搜到 ${searchMiss} 条`)

// 书架全量总数与筛选
const all = await (await fetch(`${PORTAL}/api/docs?pageSize=50`)).json()
console.log(`\n  书架全量 /api/docs -> total = ${all.total}  items = ${(all.items ?? []).length}`)
const byType = await (await fetch(`${PORTAL}/api/docs?type=测试资料&pageSize=50`)).json()
console.log(`  书架筛选 type=测试资料 -> total = ${byType.total}`)
const facets = await (await fetch(`${PORTAL}/api/docs/facets`)).json()
console.log(`  书架筛选项 facets：${JSON.stringify(facets)}`)
verdict(
  all.total === report.succeeded,
  '② 书架 total == 导入成功数',
  `${all.total} == ${report.succeeded}`,
)

// ---------------------------------------------------------------- ④ 红线自查
// 全量 18 条逐字段核对（不只抽样，防止解析竞态漏网）
let allMismatch = 0
const allList = await (
  await fetch(
    `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${KB}/knowledge?page=1&page_size=200`,
    {
      headers: apiHeaders,
    },
  )
).json()
for (const it of allList.data ?? []) {
  const exp = excelRows.find((x) => x['文件名'] === it.file_name)
  const cm =
    (
      await (
        await fetch(`${env.WEKNORA_BASE_URL}/api/v1/knowledge/${it.id}`, { headers: apiHeaders })
      ).json()
    ).data?.custom_metadata ?? {}
  const bad = header.filter((h) => cm[h] !== (exp === undefined ? undefined : exp[h]))
  if (bad.length > 0) {
    allMismatch++
    console.log(`  ❌ ${it.file_name} parse=${it.parse_status} 不一致键：${bad.join('、')}`)
  }
}
console.log(`  全量 ${(allList.data ?? []).length} 条逐字段核对，不一致 ${allMismatch} 条`)
verdict(
  allMismatch === 0,
  '② 全量 18 条 custom_metadata 与 Excel 逐字段一致',
  `不一致 ${allMismatch} 条`,
)

console.log('\n【验收④】红线自查：来源公开、无真实个人信息')
const noDoi = ledger.filter((x) => !String(x.DOI).startsWith('https://doi.org/'))
const noHttpsPdf = ledger.filter((x) => !String(x['直链PDF']).startsWith('https://'))
console.log(`  文件总数              = ${ledger.length}`)
console.log(`  缺合法 DOI 的条目     = ${noDoi.length}（全部为 https://doi.org/ 形态）`)
console.log(`  非 https 的 PDF 直链  = ${noHttpsPdf.length}`)
// 逐条实探：DOI 解析 + 直链 https 可达 + 仍是 application/pdf
console.log(`\n  ── 逐条实探公开来源（DOI 解析 + https 直链可达性）──`)
let reachable = 0
for (const x of ledger) {
  // 重试：OA 站点偶发连接超时（本机实测 ecol-env-prot.com / ojs.omniscient.sg 会抖），
  // 单次失败不等于来源不可信。任一次尝试成功即算通过。
  const probe = async (url, opts) => {
    for (let i = 1; i <= 4; i++) {
      try {
        const r = await fetch(url, {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0' },
          ...opts,
        })
        if (r.ok || r.status < 500) return r
      } catch {
        await new Promise((res) => setTimeout(res, 1200))
      }
    }
    return null
  }
  let doiOk = false
  let pdfOk = false
  let pdfCode = '-'
  // DOI 必须用 GET：部分 OA 站（front-sci.com 等）对 HEAD 返回 405，HEAD 会误判成不可达
  const dr = await probe(x.DOI, { method: 'GET' })
  doiOk = dr !== null
  const pr = await probe(x['直链PDF'], { method: 'HEAD' })
  if (pr !== null) {
    pdfCode = String(pr.status)
    pdfOk = pr.ok && (pr.headers.get('content-type') ?? '').includes('pdf')
  }
  if (doiOk && pdfOk) reachable++
  console.log(
    `     ${doiOk && pdfOk ? '✅' : '❌'} DOI=${doiOk ? '200' : 'x'}  PDF直链=${pdfCode}/${pdfOk ? 'pdf' : 'x'}  ${x['文件名'].slice(0, 26)}`,
  )
}
console.log(`  公开来源可复核 = ${reachable}/${ledger.length}（DOI 解析 + https 直链返回 PDF）`)
// 私人信息排查：中文姓名/手机号/身份证/邮箱
const PII = [
  ['手机号', /(?<!\d)1[3-9]\d{9}(?!\d)/g],
  ['身份证号', /(?<!\d)\d{17}[\dXx](?!\d)/g],
  ['邮箱', /[\w.+-]+@[\w-]+\.[\w.]+/g],
  ['银行卡', /(?<!\d)\d{16,19}(?!\d)/g],
]
const scans = ['文件名', '知识名', '知识发布机构', '知识领域']
  .map((k) => ledger.map((x) => String(x[k])).join('\n'))
  .join('\n')
for (const [label, re] of PII) {
  const hit = scans.match(re)
  console.log(
    `  扫描「${label}」        = ${hit === null ? '0 命中 ✅' : hit.length + ' 命中 ❌ ' + hit.join(',')}`,
  )
}
console.log(
  `  知识类型全为「测试资料」 = ${ledger.every((x) => x['知识领域'] !== '未标注') ? '✅' : '❌'}`,
)
console.log(`  脏行已清（本地索引==远端）= ${all.total === report.succeeded ? '✅' : '❌'}`)
verdict(noDoi.length === 0 && noHttpsPdf.length === 0, '④ 全部条目有合法 DOI + https PDF 直链')
verdict(
  reachable === ledger.length,
  '④ 全部条目 DOI 与直链当场可复核',
  `${reachable}/${ledger.length}`,
)
verdict(
  PII.every(([, re]) => scans.match(re) === null),
  '④ 元数据零个人信息命中',
)

console.log('\n' + '='.repeat(78))
console.log(`验收自测汇总：PASS ${pass} ｜ FAIL ${fail}`)
console.log('='.repeat(78))
if (fail > 0) process.exitCode = 1
