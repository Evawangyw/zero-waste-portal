// 一次性工具：生成 3 个自造的测试 PDF（无任何真实个人信息）
// 不是模块代码，只在需要重建样例文件时跑：
//   npx tsx src/modules/ingest/ingest.sample-pdf.ts
// 内容全部为虚构文本，PDF 结构手工拼装（单页 / Helvetica / 无压缩），足够让 WeKnora 解析。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface SampleSpec {
  readonly fileName: string
  readonly lines: readonly string[]
}

const SAMPLES: readonly SampleSpec[] = [
  {
    fileName: '样例文档一.pdf',
    lines: [
      '零废弃知识库 · 批量导入测试样例一',
      '本文为批量导入流程测试文档，内容全部为虚构文本。',
      '主题：可回收物分类投放指引（测试用途）',
      '不含任何真实个人信息。',
    ],
  },
  {
    fileName: '样例文档二.pdf',
    lines: [
      '零废弃知识库 · 批量导入测试样例二',
      '本文为批量导入流程测试文档，内容全部为虚构文本。',
      '主题：塑料制品减量与回收（测试用途）',
      '不含任何真实个人信息。',
    ],
  },
  {
    fileName: '样例文档三.pdf',
    lines: [
      '零废弃知识库 · 批量导入测试样例三',
      '本文为批量导入流程测试文档，内容全部为虚构文本。',
      '主题：厨余垃圾处理流程（测试用途）',
      '本行对应 Excel 里的留空元数据行，用于验证空值落「未标注」。',
      '不含任何真实个人信息。',
    ],
  },
]

function escapePdfText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1')
}

function buildPdf(lines: readonly string[]): Buffer {
  const body = lines
    .map((line, i) => (i === 0 ? `(${escapePdfText(line)}) Tj` : `T* (${escapePdfText(line)}) Tj`))
    .join('\n')
  const content = `BT /F1 12 Tf 60 760 Td 18 TL\n${body}\nET`

  const objects: readonly string[] = [
    '',
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]

  let out = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(out, 'latin1')
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefPos = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objects.length; i += 1) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

function main(): void {
  // 相对 cwd 找 inputs/files；从 backend/ 或仓库根跑都能落到同一个目录
  const target = resolve(process.cwd(), 'inputs', 'files')
  mkdirSync(target, { recursive: true })
  for (const sample of SAMPLES) {
    const buf = buildPdf(sample.lines)
    writeFileSync(join(target, sample.fileName), buf)
    console.log(`wrote ${sample.fileName} (${buf.length} bytes)`)
  }
  console.log(`目录：${target}`)
}

main()