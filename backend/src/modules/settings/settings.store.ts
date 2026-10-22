// 系统设置：问答运行参数和每个用户的预览、下载、管理权限。
// 密钥只留在数据库和进程内存里，读接口不回传百炼密钥。
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPrisma } from '../../db/prisma.js'
import { loadEnvFile } from '../../weknora/index.js'

export const BUNDLED_VECTOR_MODEL = 'Xenova/bge-small-zh-v1.5'
export const DEFAULT_LEXICAL_K = 80
export const DEFAULT_VECTOR_K = 80
export const DEFAULT_FUSED_K = 40
const MIN_K = 1
const MAX_K = 200

const KEY_VECTOR = 'ask.vectorModel'
const KEY_LEXICAL = 'ask.lexicalK'
const KEY_VECTOR_K = 'ask.vectorK'
const KEY_FUSED = 'ask.fusedK'
const KEY_BAILIAN_MODEL = 'ask.bailianModel'
const KEY_BAILIAN_URL = 'ask.bailianBaseUrl'
const KEY_BAILIAN_SECRET = 'ask.bailianApiKey'

export interface AskRuntime {
  readonly vectorModel: string
  readonly lexicalK: number
  readonly vectorK: number
  readonly fusedK: number
  readonly bailianModel: string
  readonly bailianBaseUrl: string
  /** 空串表示继续用环境变量里的密钥 */
  readonly bailianApiKey: string
}

export interface AskSettingsView {
  readonly vectorModel: string
  readonly installedVectorModels: readonly string[]
  readonly lexicalK: number
  readonly vectorK: number
  readonly fusedK: number
  readonly bailianModel: string
  readonly bailianBaseUrl: string
  readonly bailianKeySet: boolean
}

export interface UserAccessRow {
  readonly id: string
  readonly name: string
  readonly phone: string
  readonly org: string
  readonly canPreview: boolean
  readonly canDownload: boolean
  readonly isAdmin: boolean
}

export class SettingsError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SettingsError'
    this.status = status
  }
}

let runtime: AskRuntime = emptyRuntime()
let ready = false

export function peekAskSettings(): AskRuntime {
  return runtime
}

export async function ensureSiteSettings(): Promise<void> {
  const prisma = getPrisma()
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "site_settings" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`,
  )
  await ensureUserFlag('canPreview')
  await ensureUserFlag('canDownload')
  runtime = await readRuntime()
  ready = true
}

export async function askSettingsView(vectorIndexModel: string | null): Promise<{
  readonly ask: AskSettingsView
  readonly vectorIndexModel: string | null
  readonly vectorIndexMatches: boolean
}> {
  await readyOrLoad()
  return {
    ask: toView(runtime),
    vectorIndexModel,
    vectorIndexMatches: vectorIndexModel === null || vectorIndexModel === runtime.vectorModel,
  }
}

export async function listUserAccess(): Promise<readonly UserAccessRow[]> {
  await readyOrLoad()
  const rows = await getPrisma().user.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      phone: true,
      org: true,
      canPreview: true,
      canDownload: true,
      isAdmin: true,
    },
  })
  return rows
}

export async function saveAskSettings(input: {
  readonly vectorModel: string
  readonly lexicalK: number
  readonly vectorK: number
  readonly fusedK: number
  readonly bailianModel: string
  readonly bailianBaseUrl: string
  readonly bailianApiKey: string | null
}): Promise<void> {
  await readyOrLoad()
  const installed = listInstalledVectorModels()
  const vectorModel = input.vectorModel.trim()
  if (!installed.includes(vectorModel)) {
    throw new SettingsError(400, '服务器上没有这个向量模型，不能改成未安装的名字')
  }
  const lexicalK = clampK(input.lexicalK, '词法召回条数')
  const vectorK = clampK(input.vectorK, '向量召回条数')
  const fusedK = clampK(input.fusedK, '融合条数')
  const bailianModel = clip(input.bailianModel, 80)
  const bailianBaseUrl = normalizeBaseUrl(input.bailianBaseUrl)
  if (bailianModel === '') throw new SettingsError(400, '请填写百炼模型名')
  const nextKey = input.bailianApiKey === null ? runtime.bailianApiKey : input.bailianApiKey.trim()
  const next: AskRuntime = {
    vectorModel,
    lexicalK,
    vectorK,
    fusedK,
    bailianModel,
    bailianBaseUrl,
    bailianApiKey: nextKey,
  }
  await writeRuntime(next)
  runtime = next
}

export async function updateUserAccess(
  actorId: string,
  targetId: string,
  patch: { readonly canPreview?: boolean; readonly canDownload?: boolean; readonly isAdmin?: boolean },
): Promise<UserAccessRow> {
  await readyOrLoad()
  const prisma = getPrisma()
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      phone: true,
      org: true,
      canPreview: true,
      canDownload: true,
      isAdmin: true,
    },
  })
  if (target === null) throw new SettingsError(404, '没有这个用户')
  const nextAdmin = patch.isAdmin ?? target.isAdmin
  if (patch.isAdmin === false) {
    const message = adminChangeError(actorId, target.id, nextAdmin, await adminIds())
    if (message !== null) throw new SettingsError(400, message)
  }
  const saved = await prisma.user.update({
    where: { id: target.id },
    data: {
      canPreview: nextAdmin ? true : (patch.canPreview ?? target.canPreview),
      canDownload: nextAdmin ? true : (patch.canDownload ?? target.canDownload),
      isAdmin: nextAdmin,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      org: true,
      canPreview: true,
      canDownload: true,
      isAdmin: true,
    },
  })
  return saved
}

/** 取消管理权限时的拒绝原因。没有问题则返回 null。 */
export function adminChangeError(
  actorId: string,
  targetId: string,
  nextAdmin: boolean,
  adminIds: readonly string[],
): string | null {
  if (nextAdmin) return null
  if (actorId === targetId) return '不能取消自己的管理权限'
  const remaining = adminIds.filter((id) => id !== targetId)
  if (remaining.length === 0) return '至少要留下一位管理员'
  return null
}

export function listInstalledVectorModels(): readonly string[] {
  const root = resolve(modelRoot(), 'Xenova')
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const name of readdirSync(root)) {
    const onnx = resolve(root, name, 'onnx', 'model_quantized.onnx')
    if (existsSync(onnx)) found.push(`Xenova/${name}`)
  }
  found.sort()
  return found
}

function emptyRuntime(): AskRuntime {
  return {
    vectorModel: BUNDLED_VECTOR_MODEL,
    lexicalK: DEFAULT_LEXICAL_K,
    vectorK: DEFAULT_VECTOR_K,
    fusedK: DEFAULT_FUSED_K,
    bailianModel: '',
    bailianBaseUrl: '',
    bailianApiKey: '',
  }
}

async function readyOrLoad(): Promise<void> {
  if (!ready) await ensureSiteSettings()
}

async function readRuntime(): Promise<AskRuntime> {
  const rows = await getPrisma().$queryRawUnsafe<Array<{ key: string; value: string }>>(
    `SELECT "key", "value" FROM "site_settings"`,
  )
  const map = new Map(rows.map((row) => [row.key, row.value]))
  const installed = listInstalledVectorModels()
  const storedModel = map.get(KEY_VECTOR) ?? BUNDLED_VECTOR_MODEL
  const vectorModel = installed.includes(storedModel) ? storedModel : BUNDLED_VECTOR_MODEL
  return {
    vectorModel,
    lexicalK: readK(map.get(KEY_LEXICAL), DEFAULT_LEXICAL_K),
    vectorK: readK(map.get(KEY_VECTOR_K), DEFAULT_VECTOR_K),
    fusedK: readK(map.get(KEY_FUSED), DEFAULT_FUSED_K),
    bailianModel: map.get(KEY_BAILIAN_MODEL) ?? '',
    bailianBaseUrl: map.get(KEY_BAILIAN_URL) ?? '',
    bailianApiKey: map.get(KEY_BAILIAN_SECRET) ?? '',
  }
}

async function writeRuntime(next: AskRuntime): Promise<void> {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    [KEY_VECTOR, next.vectorModel],
    [KEY_LEXICAL, String(next.lexicalK)],
    [KEY_VECTOR_K, String(next.vectorK)],
    [KEY_FUSED, String(next.fusedK)],
    [KEY_BAILIAN_MODEL, next.bailianModel],
    [KEY_BAILIAN_URL, next.bailianBaseUrl],
    [KEY_BAILIAN_SECRET, next.bailianApiKey],
  ]
  for (const [key, value] of pairs) {
    await getPrisma().$executeRawUnsafe(
      `INSERT INTO "site_settings" ("key", "value") VALUES (?, ?)
       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
      key,
      value,
    )
  }
}

async function ensureUserFlag(column: 'canPreview' | 'canDownload'): Promise<void> {
  const rows = await getPrisma().$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM pragma_table_info('users')`,
  )
  if (rows.some((row) => row.name === column)) return
  await getPrisma().$executeRawUnsafe(
    `ALTER TABLE "users" ADD COLUMN "${column}" BOOLEAN NOT NULL DEFAULT 1`,
  )
}

async function adminIds(): Promise<readonly string[]> {
  const rows = await getPrisma().user.findMany({
    where: { isAdmin: true },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

function toView(source: AskRuntime): AskSettingsView {
  const env = loadEnvFile(process.env)
  return {
    vectorModel: source.vectorModel,
    installedVectorModels: listInstalledVectorModels(),
    lexicalK: source.lexicalK,
    vectorK: source.vectorK,
    fusedK: source.fusedK,
    bailianModel: source.bailianModel || envText(env, 'BAILIAN_MODEL'),
    bailianBaseUrl: source.bailianBaseUrl || envText(env, 'BAILIAN_BASE_URL'),
    bailianKeySet: source.bailianApiKey !== '' || envText(env, 'BAILIAN_API_KEY') !== '',
  }
}

function clampK(value: number, label: string): number {
  if (!Number.isInteger(value) || value < MIN_K || value > MAX_K) {
    throw new SettingsError(400, `${label}要是 ${MIN_K} 到 ${MAX_K} 的整数`)
  }
  return value
}

function readK(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < MIN_K || parsed > MAX_K) return fallback
  return parsed
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max)
}

function normalizeBaseUrl(value: string): string {
  const text = value.trim().replace(/\/+$/, '')
  if (text === '') throw new SettingsError(400, '请填写百炼接口地址')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new SettingsError(400, '百炼接口地址不是合法的网址')
  }
  if (url.protocol !== 'https:') throw new SettingsError(400, '百炼接口地址要用 https')
  return text
}

function envText(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function modelRoot(): string {
  const fromEnv = process.env['ASK_MODEL_DIR']
  if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(fromEnv.trim())
  if (existsSync(resolve(process.cwd(), 'prisma'))) return resolve(process.cwd(), 'models')
  return resolve(process.cwd(), 'backend', 'models')
}
