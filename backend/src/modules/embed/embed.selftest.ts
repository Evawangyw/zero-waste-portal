// 模块边界：embed —— 自测 / 验收脚本（每个模块一个能跑的验收命令：npm run test:embed）
//
// 跑法：cd backend && npm run test:embed
// 覆盖验收标准②：带 Origin 返回 session_token；不带 / 带错 Origin 被拒。
// 另外覆盖官方挂件 loader 实际使用的 GET 形态，以及 Q1 开关的装配。
//
// 硬约束：本脚本只打自建后端自己（临时端口），exchange 那一次真实调用会消耗一次
// WeKnora 渠道签发（不消耗模型问答额度）。
import { createApp } from '../../app.js'
import { loadEmbedConfig } from './embed.config.js'
import { EmbedError } from './embed.error.js'
import {
  assertOriginAllowed,
  isSameOriginBrowserFetch,
  reconstructRequestOrigin,
} from './embed.service.js'
import type {
  EmbedErrorResponse,
  EmbedPublicConfigResponse,
  EmbedTokenResponse,
} from './embed.types.js'

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail: string): void {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}  ${detail}`)
  } else {
    failed += 1
    console.error(`  FAIL  ${label}  ${detail}`)
  }
}

interface CallResult {
  readonly status: number
  readonly text: string
}

async function call(
  base: string,
  path: string,
  init: {
    readonly method: 'GET' | 'POST'
    readonly origin?: string
    readonly secFetchSite?: string
  },
): Promise<CallResult> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.origin !== undefined) headers['Origin'] = init.origin
  if (init.secFetchSite !== undefined) headers['Sec-Fetch-Site'] = init.secFetchSite
  const response = await fetch(`${base}${path}`, { method: init.method, headers })
  return { status: response.status, text: await response.text() }
}

/** 判断表达式是否抛出 EmbedError 且 kind 为 origin_not_allowed */
function throwsEmbedError(run: () => unknown): boolean {
  try {
    run()
    return false
  } catch (err) {
    return err instanceof EmbedError && err.kind === 'origin_not_allowed'
  }
}

function parse(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function main(): Promise<void> {
  const config = loadEmbedConfig()
  const goodOrigin = config.allowedOrigins[0]
  if (goodOrigin === undefined) {
    console.error('WEKNORA_ALLOWED_ORIGINS 为空，无法自测（先在 backend/.env 配好）')
    process.exitCode = 1
    return
  }

  const app = createApp()
  const server = app.listen(0)
  await new Promise<void>((resolve) => {
    server.once('listening', () => {
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    console.error('临时端口分配失败')
    process.exitCode = 1
    return
  }
  const base = `http://127.0.0.1:${address.port}`

  try {
    console.log(`\n[embed] 自测目标 ${base}\n`)

    // ① 公开配置：给前端拼挂件 script 用，且绝不含 publish token
    const configRes = await call(base, '/api/embed/config', { method: 'GET' })
    const configBody = parse(configRes.text) as unknown as EmbedPublicConfigResponse
    const widget = configBody.widget
    check(
      'GET /api/embed/config 200',
      configRes.status === 200 && widget !== undefined,
      `HTTP ${configRes.status}`,
    )
    check(
      'config 不泄露 publish token',
      !configRes.text.includes(config.publishToken) && !configRes.text.includes('em_'),
      '响应体内无 em_ 串',
    )
    check(
      'config 给出渠道与挂件基址',
      typeof widget?.channelId === 'string' &&
        widget.channelId !== '' &&
        typeof widget?.baseUrl === 'string' &&
        widget.baseUrl !== '' &&
        typeof widget?.tokenEndpoint === 'string' &&
        widget.tokenEndpoint !== '',
      `channelId=${widget?.channelId ?? '-'} baseUrl=${widget?.baseUrl ?? '-'} tokenEndpoint=${widget?.tokenEndpoint ?? '-'}`,
    )

    // ② 卡片正式契约：POST + 合法 Origin -> 200 + session_token
    const postOk = await call(base, '/api/embed/token', { method: 'POST', origin: goodOrigin })
    const postBody = parse(postOk.text) as unknown as EmbedTokenResponse
    check(
      'POST /api/embed/token (Origin 合法) 200',
      postOk.status === 200 && postBody.success === true,
      `HTTP ${postOk.status} body=${postOk.text.slice(0, 160)}`,
    )
    check(
      '返回 session_token（ems_ 前缀，30 分钟）',
      typeof postBody.data?.session_token === 'string' &&
        postBody.data.session_token.startsWith('ems_') &&
        postBody.data.expires_in === 1800,
      `expires_in=${postBody.data?.expires_in ?? '-'}`,
    )
    check(
      '顶层 token 与 data.session_token 同值（不存在第二份凭证）',
      postBody.token === postBody.data?.session_token,
      'token === data.session_token',
    )

    // ③ 不带 Origin -> 403（一张 token 都不发）
    const postNoOrigin = await call(base, '/api/embed/token', { method: 'POST' })
    const noOriginBody = parse(postNoOrigin.text) as unknown as EmbedErrorResponse
    check(
      'POST /api/embed/token 不带 Origin 被拒',
      postNoOrigin.status === 403 && noOriginBody.error?.kind === 'origin_not_allowed',
      `HTTP ${postNoOrigin.status} body=${postNoOrigin.text.slice(0, 120)}`,
    )
    check('被拒响应不含 token', !postNoOrigin.text.includes('ems_'), '无 ems_ 串')

    // ④ 带白名单外的 Origin -> 403
    const postBadOrigin = await call(base, '/api/embed/token', {
      method: 'POST',
      origin: 'http://evil.example.com',
    })
    const badBody = parse(postBadOrigin.text) as unknown as EmbedErrorResponse
    check(
      'POST /api/embed/token 白名单外 Origin 被拒',
      postBadOrigin.status === 403 && badBody.error?.kind === 'origin_not_allowed',
      `HTTP ${postBadOrigin.status} body=${postBadOrigin.text.slice(0, 120)}`,
    )

    // ④b 同源浏览器豁免：Origin 存在时一律严格比对白名单，豁免不生效
    const spoofHost = await call(base, '/api/embed/token', {
      method: 'POST',
      origin: 'http://evil.example.com',
      secFetchSite: 'same-origin',
    })
    check(
      '声明 same-origin 但 Origin 不在白名单仍被拒（豁免只在缺 Origin 时生效）',
      spoofHost.status === 403,
      `HTTP ${spoofHost.status}`,
    )

    // ④c 同源豁免的判定逻辑（纯函数级，不需要伪造 Host 头）
    const whitelist = ['http://localhost:5173']
    check(
      '同源豁免：Sec-Fetch-Site=same-origin 且 Host 还原 Origin 命中白名单 -> 放行',
      assertOriginAllowed(undefined, whitelist, 'http://localhost:5173') ===
        'http://localhost:5173',
      'ok',
    )
    check(
      '同源豁免：Host 还原 Origin 不在白名单 -> 仍拒',
      throwsEmbedError(() => assertOriginAllowed(undefined, whitelist, 'http://evil.example.com')),
      '403 origin_not_allowed',
    )
    check(
      '无 Origin 且无 Sec-Fetch-Site（curl 等）-> 仍拒',
      throwsEmbedError(() => assertOriginAllowed(undefined, whitelist, undefined)),
      '403 origin_not_allowed',
    )
    check(
      'isSameOriginBrowserFetch 只认 same-origin',
      isSameOriginBrowserFetch({ headers: { 'sec-fetch-site': 'same-origin' } }) === true &&
        isSameOriginBrowserFetch({ headers: { 'sec-fetch-site': 'cross-site' } }) === false &&
        isSameOriginBrowserFetch({ headers: {} }) === false,
      'ok',
    )
    check(
      'reconstructRequestOrigin 用协议 + Host 还原',
      reconstructRequestOrigin({
        protocol: 'http',
        headers: { host: 'localhost:5173' },
      }) === 'http://localhost:5173' &&
        reconstructRequestOrigin({
          protocol: 'http',
          headers: {
            host: 'demo.trycloudflare.com',
            'x-forwarded-proto': 'https',
          },
        }) === 'https://demo.trycloudflare.com',
      'ok',
    )

    // ⑤ 官方挂件 loader 走的是 GET；与 POST 必须同一套校验
    const getOk = await call(base, '/api/embed/token', { method: 'GET', origin: goodOrigin })
    const getBody = parse(getOk.text) as unknown as EmbedTokenResponse
    check(
      'GET /api/embed/token (Origin 合法) 200（官方 loader 形态）',
      getOk.status === 200 && typeof getBody.token === 'string' && getBody.token.startsWith('ems_'),
      `HTTP ${getOk.status}`,
    )
    const getNoOrigin = await call(base, '/api/embed/token', { method: 'GET' })
    check(
      'GET /api/embed/token 不带 Origin 同样被拒',
      getNoOrigin.status === 403,
      `HTTP ${getNoOrigin.status}`,
    )

    // ⑥ 白名单 Origin 回 CORS 头（前端若直连 :4000 也不必改后端）
    const corsRes = await fetch(`${base}/api/embed/config`, {
      headers: { Origin: goodOrigin, Accept: 'application/json' },
    })
    check(
      '白名单 Origin 拿到 Access-Control-Allow-Origin',
      corsRes.headers.get('access-control-allow-origin') === goodOrigin,
      `ACAO=${corsRes.headers.get('access-control-allow-origin') ?? '-'}`,
    )

    // ⑦ Q1 开关装配：只改 .env 一行即生效（此处只验配置装配，不起第二个进程）
    check(
      'Q1 开关：REQUIRE_LOGIN_FOR_ASK 默认/当前为 false（公众免登录）',
      config.requireLoginForAsk === false,
      `REQUIRE_LOGIN_FOR_ASK=${String(config.requireLoginForAsk)}`,
    )
    const q1 = loadEmbedConfig({ ...process.env, REQUIRE_LOGIN_FOR_ASK: 'true' })
    check(
      'Q1 开关：设为 true 后装配为 true（改 .env 即挂 requireAuth）',
      q1.requireLoginForAsk === true,
      `REQUIRE_LOGIN_FOR_ASK=${String(q1.requireLoginForAsk)}`,
    )

    console.log(`\n[embed] 自测结果：PASS ${passed} / FAIL ${failed}\n`)
    process.exitCode = failed === 0 ? 0 : 1
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
}

void main()
