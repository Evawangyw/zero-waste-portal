// DATA01：custom_metadata 完整性修复（只补数据，不改任何模块代码）
//
// 发现的竞态（本机实测，证据见 docs/交付记录/DATA01-交付说明与实测回显.md）：
//   ingest.run.ts 的写入顺序是「上传 → 立刻 PUT custom_metadata」，
//   但 WeKnora 上传后是**异步解析**（parse_status 走 finalizing → completed）。
//   解析链收尾时会把 custom_metadata 覆盖成解析结果（对扫描版 PDF 就是 {}）。
//   于是：落在解析窗口内的那一条，导入报告记 success、PUT 也回 200，
//   但 custom_metadata 最终被清空 -> 书架该条 year/org/docType/topics 全「未标注」。
//   18 条里中了 1 条（浅析固体废物污染防治与管理.pdf，parse_status=completed 但 cm={}）。
//
// 本脚本按「远端实存」口径核对并重 PUT 缺失项，然后连查 3 次确认不再被覆盖。
// 幂等：只补空/缺键的条目，已完整的条目不动。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const INPUTS = resolve(ROOT, 'inputs')

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
const jsonHeaders = { 'X-API-Key': env.WEKNORA_API_KEY, 'Content-Type': 'application/json' }
const readHeaders = { 'X-API-Key': env.WEKNORA_API_KEY }

// 期望元数据：以导入报告（文件 -> metadata）为准，那是 Excel 行的逐字段映射结果
const report = JSON.parse(readFileSync(resolve(INPUTS, 'import-report.json'), 'utf8'))
const expected = new Map(report.results.map((r) => [r.knowledgeId, r.metadata]))

const list = async () =>
  (
    await fetch(
      `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${kbId}/knowledge?page=1&page_size=200`,
      { headers: readHeaders },
    )
  ).json()

const items = (await list()).data ?? []
console.log(`[fix-metadata] 目标库=${kbId}  条目=${items.length}`)

const fixed = []
for (const it of items) {
  const want = expected.get(it.id)
  if (want === undefined) {
    console.log(`  [?] ${it.id} 不在导入报告里，跳过（不猜元数据）`)
    continue
  }
  const detail = (
    await (
      await fetch(`${env.WEKNORA_BASE_URL}/api/v1/knowledge/${it.id}`, { headers: readHeaders })
    ).json()
  ).data
  const cm = detail?.custom_metadata ?? {}
  const missing = Object.keys(want).filter((k) => cm[k] !== want[k])
  if (missing.length === 0) continue
  console.log(
    `  [FIX] ${it.file_name}  parse=${detail?.parse_status}  缺失/不一致 ${missing.length} 个键 -> ${missing.join('、')}`,
  )
  const r = await fetch(`${env.WEKNORA_BASE_URL}/api/v1/knowledge/${it.id}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ custom_metadata: want }),
  })
  if (!r.ok) {
    console.log(`       PUT 失败 HTTP ${r.status} ${(await r.text()).slice(0, 120)}`)
    continue
  }
  fixed.push(it.file_name)
}
console.log(
  `[fix-metadata] 本次修复 ${fixed.length} 条${fixed.length > 0 ? '：' + fixed.join('、') : ''}`,
)

// 连查 3 次（每次间隔 6s），确认解析链收尾后不再回滚为空
for (let round = 1; round <= 3; round += 1) {
  await new Promise((r) => setTimeout(r, 6000))
  const now = (await list()).data ?? []
  let empty = 0
  for (const it of now) {
    const d = (
      await (
        await fetch(`${env.WEKNORA_BASE_URL}/api/v1/knowledge/${it.id}`, { headers: readHeaders })
      ).json()
    ).data
    const want = expected.get(it.id)
    if (want === undefined) continue
    const miss = Object.keys(want).filter((k) => (d?.custom_metadata ?? {})[k] !== want[k])
    if (miss.length > 0) {
      empty++
      console.log(
        `  [!!] 第${round}轮 ${it.file_name} parse=${d?.parse_status} 仍缺 ${miss.join('、')}`,
      )
    }
  }
  console.log(`  第${round}轮复查：${now.length} 条中不完整 ${empty} 条`)
}

// 与 Excel 原始行做最终交叉核对（不依赖导入报告，独立再验一遍）
const wb = XLSX.read(readFileSync(resolve(INPUTS, 'metadata.xlsx')), { type: 'buffer' })
const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true })
const header = aoa[0]
const excelByFile = new Map(
  aoa
    .slice(1)
    .map((r) => [
      String(r[0]),
      Object.fromEntries(
        header.map((h, i) => [h, r[i] === undefined || r[i] === '' ? '未标注' : String(r[i])]),
      ),
    ]),
)
const finalItems = (await list()).data ?? []
let mismatch = 0
for (const it of finalItems) {
  const want = excelByFile.get(it.file_name)
  if (want === undefined) {
    console.log(`  [!!] ${it.file_name} 不在 Excel 里`)
    mismatch++
    continue
  }
  const cm =
    (
      await (
        await fetch(`${env.WEKNORA_BASE_URL}/api/v1/knowledge/${it.id}`, { headers: readHeaders })
      ).json()
    ).data?.custom_metadata ?? {}
  const bad = header.filter((h) => cm[h] !== want[h])
  if (bad.length > 0) {
    mismatch++
    console.log(`  [!!] ${it.file_name} 与 Excel 不一致：${bad.join('、')}`)
  }
}
console.log(
  `\n[fix-metadata] 与 Excel 逐字段最终核对：${finalItems.length} 条，不一致 ${mismatch} 条`,
)
if (mismatch > 0) process.exitCode = 1
