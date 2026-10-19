// 把指定目录里的 PDF 交给 SoMark，写入本仓库的语料库。
// 用法：SOMARK_API_KEY=密钥1;密钥2 node scripts/convert-chemicals.mjs "<pdf目录>"
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const API = 'https://somark.cn/api/v1'
const ASYNC_SIZE = 30 * 1024 * 1024
const CORPUS_ROOT = resolve(import.meta.dirname, '../data/corpus')
const DB_PATH = join(CORPUS_ROOT, 'data/app.db')
const MD_DIR = join(CORPUS_ROOT, 'storage/markdown')

const HARD_CODES = new Set([1108, 1123])
const DAILY_CODES = new Set([1131])
const RATE_CODES = new Set([1101, 1124])
const FILE_CODES = new Set([1104, 1106, 1132, 1138])

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function loadKeys() {
  const raw = [process.env['SOMARK_API_KEYS'], process.env['SOMARK_API_KEY']].filter(Boolean).join(',')
  const keys = raw
    .split(/[,;\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part.startsWith('sk-'))
  if (keys.length === 0) throw new Error('缺少 SOMARK_API_KEY')
  return keys
}

function titleOf(fileName) {
  const stem = fileName.replace(/\.pdf$/iu, '').replace(/^\d+-/u, '')
  return stem.slice(0, 180)
}

function docTypeOf(fileName) {
  if (/标准|GB|规范|导则/u.test(fileName)) return '各类标准'
  if (/报告|调研|观察|研究|调查/u.test(fileName)) return '研究报告'
  if (/指南|手册|案例|实践/u.test(fileName)) return '案例工具'
  return '政策法规'
}

function pageCount(filePath) {
  try {
    const out = execFileSync('qpdf', ['--show-npages', filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const pages = Number(out.trim())
    return Number.isFinite(pages) && pages > 0 ? pages : Number.POSITIVE_INFINITY
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function listPdfs(dir) {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.pdf') && !name.startsWith('.') && !name.startsWith('.~'))
    .map((name) => {
      const localPath = join(dir, name)
      return { localName: name, localPath, size: statSync(localPath).size, pages: pageCount(localPath) }
    })
    .sort((a, b) => a.pages - b.pages || a.size - b.size)
}

function multipart(filePath, fileName, key) {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(filePath)]), fileName)
  form.append('output_formats', 'markdown')
  form.append('api_key', key)
  return form
}

async function postForm(url, form) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 300000)
  try {
    const response = await fetch(url, { method: 'POST', body: form, signal: ctrl.signal })
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function parseSync(item, key) {
  return postForm(`${API}/parse/sync`, multipart(item.localPath, item.localName, key))
}

async function parseAsync(item, key) {
  const submit = await postForm(`${API}/parse/async`, multipart(item.localPath, item.localName, key))
  if (submit.code !== 0) return submit
  const taskId = submit.data?.task_id
  for (let i = 0; i < 60; i += 1) {
    await sleep(4000)
    const form = new FormData()
    form.append('task_id', String(taskId))
    form.append('api_key', key)
    const check = await postForm(`${API}/parse/async_check`, form)
    if (check.code !== 0) return check
    const status = check.data?.status
    if (status === 'SUCCESS') return check
    if (status === 'FAILED') return { code: 1137, message: '异步任务失败', data: null }
  }
  return { code: 1102, message: '异步任务轮询超时', data: null }
}

async function parseWithRetry(item, keys) {
  const useAsync = item.size > ASYNC_SIZE
  let keyIndex = 0
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const key = keys[keyIndex]
    let json
    try {
      json = useAsync ? await parseAsync(item, key) : await parseSync(item, key)
    } catch {
      await sleep(2000 * attempt)
      continue
    }
    if (json.code === 0) {
      return {
        markdown: json.data?.result?.outputs?.markdown || '',
        pages: json.data?.metadata?.page_num || 0,
        keyIndex,
      }
    }
    if (HARD_CODES.has(json.code) || DAILY_CODES.has(json.code)) {
      if (keyIndex + 1 < keys.length) {
        keyIndex += 1
        console.log(`额度不足，切换到第 ${keyIndex + 1} 个账号`)
        attempt -= 1
        continue
      }
      const error = new Error(json.message || '额度不足')
      error.code = json.code
      error.quota = true
      throw error
    }
    if (FILE_CODES.has(json.code)) return { fileError: { code: json.code, message: json.message } }
    await sleep((RATE_CODES.has(json.code) ? 2500 : 2000) * attempt)
  }
  return { fileError: { code: 0, message: '超过最大重试次数仍失败' } }
}

function splitIntoChunks(text, size = 350, overlap = 60) {
  const paragraphs = String(text || '')
    .split(/\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
  const chunks = []
  let buffer = ''
  const flush = (value) => {
    const trimmed = value.trim()
    if (trimmed) chunks.push(trimmed)
  }
  for (const para of paragraphs) {
    if (para.length <= size) {
      if (buffer && buffer.length + 1 + para.length > size) {
        flush(buffer)
        buffer = para
      } else {
        buffer = buffer ? `${buffer}\n${para}` : para
      }
    } else {
      if (buffer) {
        flush(buffer)
        buffer = ''
      }
      const sentences = para.match(/[^。！？；\n]*[。！？；]?/gu)?.filter(Boolean) || [para]
      let current = ''
      for (const sentence of sentences) {
        if (current.length + sentence.length > size) {
          flush(current)
          current = (overlap > 0 ? current.slice(-overlap) : '') + sentence
        } else {
          current += sentence
        }
      }
      if (current.trim()) buffer = current
    }
  }
  flush(buffer)
  return chunks
}

function saveDocument(db, item, markdown, pages) {
  const mdName = `md-${createHash('sha1').update(item.localName).digest('hex').slice(0, 16)}.md`
  mkdirSync(MD_DIR, { recursive: true })
  writeFileSync(join(MD_DIR, mdName), markdown)
  const info = db
    .prepare(
      `INSERT INTO documents (title, organization, year, doc_type, topic, md_path, source_text, source_key, is_sample, status)
       VALUES (?, NULL, NULL, ?, '其他', ?, ?, ?, 0, 'approved')`,
    )
    .run(titleOf(item.localName), docTypeOf(item.localName), `storage/markdown/${mdName}`, markdown, item.localName)
  const docId = Number(info.lastInsertRowid)
  const insertChunk = db.prepare('INSERT INTO chunks (document_id, chunk_index, content) VALUES (?, ?, ?)')
  const chunks = splitIntoChunks(markdown)
  db.exec('BEGIN')
  try {
    chunks.forEach((content, index) => insertChunk.run(docId, index, content))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { docId, pages, chunks: chunks.length }
}

async function main() {
  const dir = process.argv[2]
  if (!dir || !existsSync(dir)) throw new Error('请传入 PDF 目录')
  if (!existsSync(DB_PATH)) throw new Error(`语料库不存在：${DB_PATH}`)
  const keys = loadKeys()
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  const seen = new Set(db.prepare('SELECT source_key FROM documents').all().map((row) => String(row.source_key)))
  const pending = listPdfs(dir).filter((item) => !seen.has(item.localName))
  console.log(`待转换 ${pending.length} 份，账号 ${keys.length} 个，目录 ${dir}`)
  let done = 0
  let activeKey = 0
  for (const item of pending) {
    const result = await parseWithRetry(item, keys.slice(activeKey))
    if (typeof result.keyIndex === 'number') activeKey += result.keyIndex
    if (result.fileError) {
      console.log(`失败 ${item.localName} ${result.fileError.code} ${result.fileError.message}`)
      continue
    }
    if (result.markdown.trim().length < 20) {
      console.log(`空白 ${item.localName} ${result.pages} 页`)
      continue
    }
    const saved = saveDocument(db, item, result.markdown, result.pages)
    done += 1
    console.log(`完成 ${item.localName} 文档 ${saved.docId} ${saved.pages} 页 ${saved.chunks} 段`)
  }
  console.log(`本轮新完成 ${done} 份`)
  db.close()
}

main().catch((error) => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
  const quota = error && typeof error === 'object' && error.quota === true
  console.error(quota ? `额度停止 ${code} ${error.message}` : error instanceof Error ? error.message : error)
  process.exit(quota ? 2 : 1)
})
