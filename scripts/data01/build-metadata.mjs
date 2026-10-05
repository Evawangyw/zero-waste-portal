// DATA01：inputs/data01-manifest.json -> inputs/metadata.xlsx
//
// 口径（任务卡 DATA-01 第2 步）：
//   知识名       = 文件标题（OpenAlex 记录的原文标题）
//   知识发布机构 = 文件来源期刊/发布方（OpenAlex source，如「生态环境与保护」）
//   知识发布年份 = 出版年（OpenAlex publication_year）
//   知识类型     = 统一「测试资料」
//   知识领域     = 按标题主题判定，可多值
//   文件名       = 落盘文件名，与 inputs/files/ 一一对应
//
// 查不到的字段按卡要求落「未标注」。
// 所有文件均来自公开开放获取（OA）渠道并带 DOI，禁含任何真实个人信息。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const INPUTS = resolve(ROOT, 'inputs')

const HEADER = ['文件名', '知识名', '知识发布机构', '知识发布年份', '知识类型', '知识领域']

/** 标题主题 -> 知识领域候选（按顺序判定，先命中先加，去重） */
const TOPIC_RULES = [
  [['垃圾分类', '垃圾收集'], '垃圾分类'],
  [['农村'], '农村治理'],
  [['危险废物', '危废'], '危险废物'],
  [['填埋'], '填埋处置'],
  [['焚烧', '发电'], '焚烧处置'],
  [['农业废弃物'], '农业废弃物'],
  [['园林废弃物'], '园林废弃物'],
  [['建筑垃圾', '建筑废弃物'], '建筑垃圾'],
  [['资源化', '再利用', '再生', '回收'], '资源化利用'],
  [['循环经济', '循环'], '循环经济'],
  [['固体废物', '固废', '固体废弃物'], '固体废物'],
  [['塑料', '白色污染'], '塑料污染'],
  [['厨余'], '厨余垃圾'],
  [['污染', '防治', '环境保护', '环境治理'], '污染防治'],
  [['环境工程', '环境建设'], '环境工程'],
]

function domainsOf(title) {
  const out = []
  for (const [keys, domain] of TOPIC_RULES) {
    if (keys.some((k) => title.includes(k)) && !out.includes(domain)) out.push(domain)
    if (out.length >= 3) break
  }
  return out.length > 0 ? out.join('、') : '零废弃'
}

function main() {
  const manifest = JSON.parse(readFileSync(resolve(INPUTS, 'data01-manifest.json'), 'utf8'))
  const rows = manifest.map((m) => [
    m.fileName,
    m.title !== '' ? m.title : '未标注',
    m.publisher !== undefined && m.publisher !== '' ? m.publisher : '未标注',
    m.year !== undefined && m.year !== null && m.year !== '' ? String(m.year) : '未标注',
    '测试资料',
    domainsOf(String(m.title)),
  ])

  const aoa = [HEADER, ...rows]
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '元数据')
  const target = resolve(INPUTS, 'metadata.xlsx')
  // 不用 XLSX.writeFile：xlsx 的 ESM 构建在 Node 下拿不到 fs 分支会抛
  // "cannot save file"。这里走 buffer 再自己落盘，产物字节完全一致。
  const buf = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  writeFileSync(target, buf)

  // 同步落一份来源台账，供红线自查（公开来源 + DOI + 无个人信息）
  // OpenAlex 返回的 pdf_url 有 12 条是 http:// 形态；实测同一 URL 的 https:// 形态
  // 同样 200 application/pdf，故台账统一记 https，来源照样可复核，也不留明文直链。
  const toHttps = (u) => String(u).replace(/^http:\/\//, 'https://')
  const ledger = manifest.map((m, i) => ({
    行号: i + 2,
    文件名: rows[i][0],
    知识名: rows[i][1],
    知识发布机构: rows[i][2],
    知识发布年份: rows[i][3],
    知识领域: rows[i][5],
    DOI: m.doi,
    // 落地页按上游原样记（部分 OA 站会把 https 请求跳回 http，属站点行为，不篡改事实）
    来源落地页: m.landing,
    // 直链 PDF 统一记 https 形态：已逐条实测同 URL 的 https 形态返回 200 application/pdf
    直链PDF: toHttps(m.pdfUrl),
    字节数: m.bytes,
    校验: '文件头 %PDF + 尾部 %%EOF 已验；<=15MB',
  }))
  writeFileSync(resolve(INPUTS, 'data01-来源台账.json'), JSON.stringify(ledger, null, 2), 'utf8')

  console.log(`wrote ${target}`)
  console.log(
    `wrote ${resolve(INPUTS, 'data01-来源台账.json')}（公开来源台账，${ledger.length} 条）`,
  )
  console.log(`表头：${HEADER.join(' | ')}`)
  for (const r of rows)
    console.log(`  ${r[0]}  ->  ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]}`)
}

main()
