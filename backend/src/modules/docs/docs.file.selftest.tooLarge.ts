// 模块边界：docs（文件层 · tooLarge 分支可达性证明）
// 契约（模块内）：在**真实 HTTP 层**上证明验收④ 要求的分支可达
// 用法：npx tsx src/modules/docs/docs.file.selftest.tooLarge.ts
//
// 做法：不改代码、不改 .env、不用 Docker —— 在本进程 createApp() 起一个临时监听（127.0.0.1:4101），
// 只改内存里的 PREVIEW_MAX_BYTES（阈值是 env 可配常量），再用真实 id 打 /api/docs/:id/preview。
// 这样证明的是「HTTP 响应体里 tooLarge 字段真的存在、分支真的走通」，
// 而不是只在单测里调纯函数。跑完自动关进程，不留残留监听。
import { createServer } from 'node:http'
import { loadEnvFile } from '../../weknora/index.js'
import { createApp } from '../../app.js'

const PORT = 4101
const REAL_PDF_ID = 'b1bfb639-734d-44e8-a642-a8ed1e4e14ee' // 1408332 字节 pdf（42 条里的真实 id）
const REAL_XLSX_ID = '945ae5d6-b6ff-4541-8047-7bad2ac9e48a' // 13260 字节 xlsx

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

function setMaxBytes(value: number): void {
  process.env['PREVIEW_MAX_BYTES'] = String(value)
}

async function main(): Promise<void> {
  loadEnvFile()
  console.log('临时 HTTP 服务（127.0.0.1:4101），只改内存里的 PREVIEW_MAX_BYTES，不动代码与 .env\n')

  const server = createServer(createApp())
  await new Promise<void>((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      resolve()
    })
  })

  try {
    console.log('=== A. 阈值 1000B：PDF 1408332B > 阈值 -> tooLarge:true ===')
    setMaxBytes(1000)
    const big = await fetch(`http://127.0.0.1:${PORT}/api/docs/${REAL_PDF_ID}/preview`)
    const bigBody: unknown = await big.json()
    console.log(`  HTTP ${big.status}`)
    console.log(`  ${JSON.stringify(bigBody)}`)
    check('响应 200', big.status === 200, String(big.status))
    check(
      'HTTP 响应体里 tooLarge=true 字段存在',
      readNested(bigBody, 'preview', 'tooLarge') === true,
      JSON.stringify(bigBody),
    )
    check(
      'streamable=false（明确改走下载）',
      readNested(bigBody, 'preview', 'streamable') === false,
    )
    check('给出 downloadUrl 引导下载', typeof readNested(bigBody, 'downloadUrl') === 'string')
    check(
      '回的是 JSON 不是文件流',
      (big.headers.get('content-type') ?? '').includes('application/json'),
    )

    console.log('\n=== B. 阈值 1000B：xlsx 仍判 unsupported（类型优先于体积） ===')
    const xl = await fetch(`http://127.0.0.1:${PORT}/api/docs/${REAL_XLSX_ID}/preview`)
    const xlBody: unknown = await xl.json()
    console.log(`  HTTP ${xl.status}`)
    console.log(`  ${JSON.stringify(xlBody)}`)
    check(
      'unsupported=true',
      readNested(xlBody, 'preview', 'unsupported') === true,
      JSON.stringify(xlBody),
    )
    check(
      'tooLarge=false（xlsx 不是体积问题）',
      readNested(xlBody, 'preview', 'tooLarge') === false,
    )

    console.log('\n=== C. 阈值 2MB：同一 PDF < 阈值 -> 真开流（阈值两侧都可达） ===')
    setMaxBytes(2 * 1024 * 1024)
    const small = await fetch(`http://127.0.0.1:${PORT}/api/docs/${REAL_PDF_ID}/preview`)
    const ct = small.headers.get('content-type') ?? ''
    const bytes = new Uint8Array(await small.arrayBuffer())
    console.log(`  HTTP ${small.status}  Content-Type: ${ct}  字节数: ${bytes.byteLength}`)
    check('Content-Type: application/pdf（真流式透传）', ct === 'application/pdf', ct)
    check(
      'Content-Disposition: inline',
      (small.headers.get('content-disposition') ?? '').startsWith('inline'),
    )
    check(
      '流字节数与 file_size 一致（1408332）',
      bytes.byteLength === 1408332,
      String(bytes.byteLength),
    )
    check('流首字节是 %PDF（内容确实是 PDF）', String.fromCharCode(...bytes.slice(0, 4)) === '%PDF')
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }

  console.log(`\n=== 汇总：${passed} PASS / ${failures.length} FAIL ===`)
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  }
}

/** 安全取嵌套值（unknown 上禁 any 逃逸） */
function readNested(source: unknown, ...keys: readonly string[]): unknown {
  let current: unknown = source
  for (const key of keys) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

void main()
