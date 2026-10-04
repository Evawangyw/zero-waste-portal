// 契约（模块内）：embed 模块业务逻辑
//  - 校验访客 Origin 是否命中白名单（命中才允许换 token，这是本卡最重要的一道闸）
//  - 用后端持有的 publish token 调 WeKnora exchange，换 30 分钟短效 session token
//  - 拼装挂件需要的公开配置（无密钥）
//
// 与 weknora 对接层的区别（刻意不复用，属模块边界）：
//  exchange 走的是 `Authorization: Embed em_...`，而对接层固定 `X-API-Key`；
//  且 exchange 必须带业务宿主 `Origin`（对接层的 API-key 通道不需要）。
//  两套鉴权语义不同，硬塞进对接层会污染 T01 已验收代码，故本模块自带一次最小 fetch。
import { EmbedError } from './embed.error.js'
import { normalizeOrigin } from './embed.config.js'
import type { EmbedConfig } from './embed.config.js'
import type { EmbedTokenResponse, EmbedWidgetPublicConfig } from './embed.types.js'

/** 换到的会话凭证 */
export interface SessionToken {
  readonly sessionToken: string
  readonly expiresIn: number
}

/**
 * 校验访客 Origin：缺失或不在白名单一律 403 origin_not_allowed。
 * 返回归一化后的 Origin，供后续转发给 WeKnora（转发的一定是被我们验过的那个值，
 * 不做任何"猜测补全"，白名单外的 origin 绝不外发）。
 *
 * 唯一的例外是**同源浏览器请求**：按 Fetch 规范，同源 GET 不会带 Origin 头
 * （官方挂件 loader 的 token 拉取就是同源 GET），若一律拒绝，同源反代部署
 * （vite dev 的 /api 代理、生产 nginx 的 /api 反代）将永远换不到 token。
 * 因此补一条豁免：Origin 缺失 **且** `Sec-Fetch-Site: same-origin`（浏览器强制附加，
 * JS 无法伪造）**且** 由 Host 还原出的本站 Origin 也在白名单里，才放行。
 * curl 等非浏览器客户端不带 Sec-Fetch-*，仍按"缺 Origin"拒绝（验收标准②成立）。
 */
export function assertOriginAllowed(
  rawOrigin: string | undefined,
  allowedOrigins: readonly string[],
  sameOriginFallback: string | undefined = undefined,
): string {
  const origin = normalizeOrigin(rawOrigin)
  if (origin === '') {
    const fallback = normalizeOrigin(sameOriginFallback)
    if (fallback !== '' && allowedOrigins.includes(fallback)) return fallback
    throw new EmbedError({
      kind: 'origin_not_allowed',
      status: 403,
      message: '缺少 Origin 头：挂件凭证只发给白名单内的业务宿主',
    })
  }
  if (!allowedOrigins.includes(origin)) {
    throw new EmbedError({
      kind: 'origin_not_allowed',
      status: 403,
      message: `Origin 不在白名单内：${origin}`,
    })
  }
  return origin
}

/**
 * 是否属于"同源浏览器请求"豁免场景。
 * 只看 Sec-Fetch-Site（浏览器强制附加、页面 JS 无法覆盖/伪造）；
 * Origin 存在时一律不走这里（Origin 存在就必须严格比对白名单）。
 */
export function isSameOriginBrowserFetch(req: {
  readonly headers: Record<string, unknown>
}): boolean {
  const site = req.headers['sec-fetch-site']
  return typeof site === 'string' && site.toLowerCase() === 'same-origin'
}

/** 由请求本身还原本站 Origin（协议 + Host），供上面的同源豁免比对白名单 */
export function reconstructRequestOrigin(req: {
  readonly protocol: string
  readonly headers: Record<string, unknown>
}): string | undefined {
  const host = req.headers.host
  if (typeof host !== 'string' || host.trim() === '') return undefined
  const protocol = typeof req.protocol === 'string' ? req.protocol : 'http'
  return `${protocol}://${host.trim()}`
}

/**
 * 调 WeKnora 的 exchange 换 session token。
 * 实测（主控 T05T06 卡 + 本轮 1 次验证）：
 *   POST {base}/api/v1/embed/{channelId}/exchange
 *   Authorization: Embed em_...   —— 必须头传，body 传 origin 无效
 *   Origin: <业务宿主>            —— 必须命中渠道 allowed_origins，缺/错一律 403
 *   -> 200 {"success":true,"data":{"session_token":"ems_...","expires_in":1800}}
 */
export async function exchangeSessionToken(
  config: EmbedConfig,
  visitorOrigin: string,
): Promise<SessionToken> {
  const url = `${config.baseUrl}/api/v1/embed/${encodeURIComponent(config.channelId)}/exchange`
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, config.timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        // publish token 只出现在这一行，源码/响应/日志都不回显
        Authorization: `Embed ${config.publishToken}`,
        // 主控实测：Origin 必须走请求头，body 里传无效
        Origin: visitorOrigin,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
  } catch (err) {
    throw EmbedError.from(err, '调用 WeKnora 凭证交换接口失败')
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text().catch(() => '')
  if (!response.ok) {
    // 上游文案可能含内部细节，对外只给摘要；完整响应写服务端日志
    console.error(`[embed] WeKnora exchange HTTP ${response.status}：${text.slice(0, 200)}`)
    throw new EmbedError({
      kind: 'upstream_error',
      status: 502,
      message: `WeKnora 凭证交换失败（上游 HTTP ${response.status}）`,
    })
  }

  const sessionToken = readSessionToken(text)
  const expiresIn = readExpiresIn(text)
  if (sessionToken === '') {
    throw new EmbedError({
      kind: 'upstream_error',
      status: 502,
      message: 'WeKnora 凭证交换响应里没有 session_token',
    })
  }
  return { sessionToken, expiresIn }
}

/** 拼 200 响应体：顶层 token/expiresIn 与信封 data.session_token/expires_in 是同一个值 */
export function buildTokenResponse(result: SessionToken): EmbedTokenResponse {
  const expiresIn = result.expiresIn > 0 ? result.expiresIn : 1800
  return {
    success: true,
    token: result.sessionToken,
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    data: { session_token: result.sessionToken, expires_in: expiresIn },
  }
}

/**
 * 拼挂件公开配置（前端据此注入 weknora-widget.js）。
 * tokenEndpoint 直接下发 .env 里配的地址：
 *  - 绝对地址（跨源）：浏览器 fetch 必带 Origin 头，走严格白名单校验（推荐，dev 即此形态）；
 *  - 相对路径（同源）：交给上面的同源豁免判定（生产 nginx 反代 /api 时用）。
 */
export function buildWidgetConfig(config: EmbedConfig): EmbedWidgetPublicConfig {
  return {
    baseUrl: config.widgetBaseUrl,
    channelId: config.channelId,
    tokenEndpoint: config.tokenEndpointPath,
    position: config.widgetPosition,
    title: config.widgetTitle,
    requireLoginForAsk: config.requireLoginForAsk,
    allowedOrigins: [...config.allowedOrigins],
  }
}

// ------------------------------------------------------------------ 解析

function readSessionToken(text: string): string {
  const data = asRecord(parseJsonSafe(text))
  const inner = asRecord(data['data'])
  return readString(inner['session_token'])
}

function readExpiresIn(text: string): number {
  const data = asRecord(parseJsonSafe(text))
  const inner = asRecord(data['data'])
  const raw = inner['expires_in']
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
