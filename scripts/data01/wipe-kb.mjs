// DATA01 辅助：把「111」库清成指定状态（默认 total=0），供重复演练/重建。
// 只允许作用于显式传入的库；默认 --dry-run，必须加 --wipe 才真删。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
function loadEnv() {
  const out = {}
  for (const line of readFileSync(resolve(ROOT, 'backend', '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m !== null) out[m[1]] = m[2]
  }
  return out
}
const env = loadEnv()
let kbId = ''
let wipe = false
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--kb') {
    kbId = argv[i + 1] ?? ''
    i += 1
  } else if (argv[i] === '--wipe') {
    wipe = true
  } else throw new Error(`未知参数 ${argv[i]}\n用法：--kb <知识库ID> [--wipe]`)
}
if (kbId === '') throw new Error('必须显式传 --kb <知识库ID>')

const h = { 'X-API-Key': env.WEKNORA_API_KEY }
const list = await (
  await fetch(
    `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${kbId}/knowledge?page=1&page_size=200`,
    { headers: h },
  )
).json()
const ids = (list.data ?? []).map((x) => x.id)
console.log(
  `[wipe-kb] 目标库=${kbId}  当前 total=${ids.length}  模式=${wipe ? '真删(--wipe)' : '演练(dry-run)'}`,
)
if (!wipe) {
  console.log('[wipe-kb] 加 --wipe 执行清库')
} else {
  let ok = 0
  let bad = 0
  for (const id of ids) {
    const r = await fetch(`${env.WEKNORA_BASE_URL}/api/v1/knowledge/${id}`, {
      method: 'DELETE',
      headers: h,
    })
    if (r.ok) ok++
    else {
      bad++
      console.log(`  [x] 删除失败 ${id} -> HTTP ${r.status} ${(await r.text()).slice(0, 120)}`)
    }
  }
  const after = await (
    await fetch(
      `${env.WEKNORA_BASE_URL}/api/v1/knowledge-bases/${kbId}/knowledge?page=1&page_size=1`,
      { headers: h },
    )
  ).json()
  console.log(`[wipe-kb] 已删 ${ok} 条，失败 ${bad} 条；清库后 total=${after.total}`)
}
