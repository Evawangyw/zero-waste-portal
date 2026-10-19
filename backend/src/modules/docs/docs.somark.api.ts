// SoMark HTTP 客户端。密钥只从环境变量读取，不进代码、不进日志。
import { readFileSync } from 'node:fs'

import { loadEnvFile } from '../../weknora/index.js'
import type { SomarkClient, SomarkConvertInput, SomarkMarkdown } from './docs.somark.js'

const ASYNC_BYTES = 30 * 1024 * 1024

const API = 'https://somark.cn/api/v1'
const HARD_CODES = new Set([1108, 1123])
const DAILY_CODES = new Set([1131])
const RATE_CODES = new Set([1101, 1124])
const FILE_CODES = new Set([1104, 1106, 1132, 1138])

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

export function readSomarkKeys(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const merged = env === process.env ? loadEnvFile(env) : env
  const raw = [merged['SOMARK_API_KEYS'], merged['SOMARK_API_KEY']]
    .filter((value): value is string => typeof value === 'string')
    .join(',')
  return raw
    .split(/[,;\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part.startsWith('sk-'))
}

export function createSomarkClient(keys: readonly string[]): SomarkClient {
  return {
    convert(input: SomarkConvertInput): Promise<SomarkMarkdown | null> {
      return parseWithKeys(input, keys)
    },
  }
}

async function parseWithKeys(input: SomarkConvertInput, keys: readonly string[]): Promise<SomarkMarkdown> {
  let keyIndex = 0
  let lastMessage = 'SoMark 转换失败'
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const key = keys[keyIndex]
    if (key === undefined) break
    let json: unknown
    try {
      json = input.fileSize > ASYNC_BYTES ? await parseAsync(input, key) : await parseSync(input, key)
    } catch {
      await sleep(2000 * attempt)
      continue
    }
    const parsed = readSuccess(json)
    if (parsed !== null) return parsed
    const code = readCode(json)
    lastMessage = readMessage(json) || lastMessage
    if (HARD_CODES.has(code) || DAILY_CODES.has(code)) {
      if (keyIndex + 1 < keys.length) {
        keyIndex += 1
        attempt -= 1
        continue
      }
      throw new Error(lastMessage)
    }
    if (FILE_CODES.has(code)) throw new Error(lastMessage)
    await sleep((RATE_CODES.has(code) ? 2500 : 2000) * attempt)
  }
  throw new Error(lastMessage)
}

async function parseSync(input: SomarkConvertInput, key: string): Promise<unknown> {
  return postForm(`${API}/parse/sync`, multipart(input, key))
}

async function parseAsync(input: SomarkConvertInput, key: string): Promise<unknown> {
  const submit = await postForm(`${API}/parse/async`, multipart(input, key))
  if (readCode(submit) !== 0) return submit
  const taskId = readTaskId(submit)
  if (taskId === '') return { code: 1102, message: '异步任务没有编号' }
  for (let i = 0; i < 60; i += 1) {
    await sleep(4000)
    const form = new FormData()
    form.append('task_id', taskId)
    form.append('api_key', key)
    const check = await postForm(`${API}/parse/async_check`, form)
    if (readCode(check) !== 0) return check
    const status = readStatus(check)
    if (status === 'SUCCESS') return check
    if (status === 'FAILED') return { code: 1137, message: '异步任务失败' }
  }
  return { code: 1102, message: '异步任务轮询超时' }
}

function multipart(input: SomarkConvertInput, key: string): FormData {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(input.filePath)]), input.fileName)
  form.append('output_formats', 'markdown')
  form.append('api_key', key)
  return form
}

async function postForm(url: string, form: FormData): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 300000)
  try {
    const response = await fetch(url, { method: 'POST', body: form, signal: ctrl.signal })
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function readSuccess(value: unknown): SomarkMarkdown | null {
  if (readCode(value) !== 0 || !isRecord(value)) return null
  const data = value['data']
  if (!isRecord(data)) return { markdown: '', pages: 0 }
  const result = data['result']
  const outputs = isRecord(result) ? result['outputs'] : undefined
  const markdown = isRecord(outputs) && typeof outputs['markdown'] === 'string' ? outputs['markdown'] : ''
  const metadata = data['metadata']
  const pages = isRecord(metadata) && typeof metadata['page_num'] === 'number' ? metadata['page_num'] : 0
  return { markdown, pages }
}

function readCode(value: unknown): number {
  if (!isRecord(value) || typeof value['code'] !== 'number') return -1
  return value['code']
}

function readMessage(value: unknown): string {
  if (!isRecord(value) || typeof value['message'] !== 'string') return ''
  return value['message']
}

function readTaskId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value['data'])) return ''
  const taskId = value['data']['task_id']
  return typeof taskId === 'string' ? taskId : ''
}

function readStatus(value: unknown): string {
  if (!isRecord(value) || !isRecord(value['data'])) return ''
  const status = value['data']['status']
  return typeof status === 'string' ? status : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
