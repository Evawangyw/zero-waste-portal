// 模块边界：docs（文件层 · 预览票据）
// 契约：
//   issuePreviewTicket(docId, allowUnlisted) -> 不可猜测的短时票据
//   verifyPreviewTicket(ticket, docId) -> 命中且未过期则返回授权，否则 null
//   buildNamedPreviewUrl(docId, fileName, ticket) -> 同源路径，最后一段是原文件名
//
// 浏览器内置 PDF 阅读器的工具栏文件名取自地址最后一段。
// 前端若先把预览下成 blob 再塞进 iframe，地址是 blob:<uuid>，工具栏就只剩这串 UUID，
// 和页面上的标题、原文件名对不上。iframe 改为直接打开这条带原文件名的地址。
//
// 票据可重复使用：PDF 插件加载、打印、工具栏另存都会再次请求同一地址。
// 它不是登录 JWT，泄漏也只能在有效期内预览这一份资料。
import { randomBytes } from 'node:crypto'

/** 打开后的阅读、打印、另存都还要能再请求，两小时盖住一次阅读 */
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000
const MAX_TICKETS = 5000

interface PreviewGrant {
  readonly docId: string
  readonly expiresAt: number
  readonly allowUnlisted: boolean
}

const tickets = new Map<string, PreviewGrant>()

export function issuePreviewTicket(
  docId: string,
  allowUnlisted: boolean,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const now = Date.now()
  pruneTickets(now)
  const ticket = randomBytes(32).toString('base64url')
  tickets.set(ticket, { docId, expiresAt: now + ttlMs, allowUnlisted })
  return ticket
}

/** 不消费票据。docId 不符视为未授权，避免拿 A 的票据去打开 B。 */
export function verifyPreviewTicket(
  ticket: string,
  docId: string,
  now: number = Date.now(),
): { readonly allowUnlisted: boolean } | null {
  const grant = tickets.get(ticket)
  if (grant === undefined) return null
  if (grant.expiresAt <= now) {
    tickets.delete(ticket)
    return null
  }
  if (grant.docId !== docId) return null
  return { allowUnlisted: grant.allowUnlisted }
}

/** 路径最后一段必须是原文件名，PDF 工具栏读的就是这一段。 */
export function buildNamedPreviewUrl(docId: string, fileName: string, ticket: string): string {
  const leaf = previewLeafName(fileName)
  const params = new URLSearchParams({ ticket })
  return `/api/docs/${encodeURIComponent(docId)}/preview-named/${encodeURIComponent(leaf)}?${params.toString()}`
}

/** 只留一段文件名：去掉路径分隔符，避免被路由切成多段。 */
export function previewLeafName(fileName: string): string {
  const cleaned = fileName.replace(/[\\/]/g, '-').replace(/^\.+/, '').trim()
  return cleaned === '' ? 'preview.bin' : cleaned
}

function pruneTickets(now: number): void {
  for (const [key, grant] of tickets) {
    if (grant.expiresAt <= now) tickets.delete(key)
  }
  if (tickets.size <= MAX_TICKETS) return
  const overflow = tickets.size - MAX_TICKETS
  let dropped = 0
  for (const key of tickets.keys()) {
    if (dropped >= overflow) break
    tickets.delete(key)
    dropped += 1
  }
}
