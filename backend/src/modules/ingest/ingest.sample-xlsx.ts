// 一次性工具：生成 inputs/metadata.xlsx（3 行迷你表）
// 不是模块代码，只在需要重建样例 Excel 时跑：
//   npx tsx src/modules/ingest/ingest.sample-xlsx.ts
//
// 3 行口径（任务卡验收标准 1）：
//  第 2 行：完整元数据，知识领域 =「垃圾分类、塑料」（多值）
//  第 3 行：完整元数据，知识领域 =「厨余垃圾」
//  第 4 行：知识发布机构 / 年份 / 类型 / 领域 全留空 -> 验收「空值落未标注」
// 内容全部虚构，禁含任何真实个人信息。
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'

const HEADER: readonly string[] = [
  '文件名',
  '知识名',
  '知识发布机构',
  '知识发布年份',
  '知识类型',
  '知识领域',
]

const ROWS: readonly (readonly (string | number)[])[] = [
  [
    '样例文档一.pdf',
    '生活垃圾分类投放指引（样例一）',
    '示例公益基金会',
    2023,
    '投放指引',
    '垃圾分类、塑料',
  ],
  [
    '样例文档二.pdf',
    '塑料制品减量与回收指南（样例二）',
    '示例公益基金会',
    2024,
    '操作指南',
    '垃圾分类、塑料',
  ],
  // 全空元数据行：留空验证「未标注」
  ['样例文档三.pdf', '厨余垃圾处理流程（样例三）', '', '', '', ''],
]

function main(): void {
  const target = resolve(process.cwd(), 'inputs', 'metadata.xlsx')
  mkdirSync(resolve(process.cwd(), 'inputs'), { recursive: true })
  const aoa: (readonly (string | number)[])[] = [HEADER, ...ROWS]
  const sheet = XLSX.utils.aoa_to_sheet(aoa as (string | number)[][])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '元数据')
  XLSX.writeFile(book, target)
  console.log(`wrote ${target}`)
  console.log(`表头：${HEADER.join(' | ')}`)
  for (const [i, row] of ROWS.entries()) console.log(`第 ${i + 2} 行：${row.join(' | ')}`)
}

main()
