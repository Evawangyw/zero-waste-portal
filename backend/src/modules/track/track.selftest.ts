// 模块边界：track —— 自测 / 验收脚本（每个模块一个能跑的验收命令：npm run test:track）
//
// 跑法：cd backend && npm run test:track
//
// 覆盖任务卡验收：
//   ① POST /api/track 单条 + 批量各一次 -> EventLog 落库行数对得上（accepted == 实际行数）
//   ③ summary 字段齐全、口径自洽（uv/pv/检索词/零结果词/下载/提问无答案率）
//   ④ 无答案判定规则（judgeNoAnswer 正例 / 反例 / 未判定三态）
//   ⑤ 守卫：summary 未带任何凭证 -> 401；带错口令 -> 401
//
// 硬约束：
//  - 只打自建后端自己（临时端口），不碰 8080 的 WeKnora；
//  - 探针事件带唯一 sessionId 前缀，跑完**按该前缀删干净**，不污染看板口径；
//  - 不建用户、不改任何既有数据（管理员路径由 track.admin.cli.ts + 交付文档覆盖）。
import { loadEnvFile } from '../../weknora/index.js'
import { getPrisma } from '../../db/prisma.js'
import { createApp } from '../../app.js'
import { judgeNoAnswer, matchesNoAnswerPhrase, normalizeForMatch } from './track.answer.js'
import { loadTrackAdminConfig, verifyAdminToken } from './track.admin.js'
import { countEventsBySession, deleteEventsBySession } from './track.repo.js'
import { buildStatsSummary, toAsksSummary, toEventCounts } from './track.stats.js'
import type { StatsSummaryResponse } from './track.types.js'

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
    readonly body?: unknown
    readonly headers?: Record<string, string>
  },
): Promise<CallResult> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  for (const [key, value] of Object.entries(init.headers ?? {})) headers[key] = value
  // 必须显式带 Content-Type：body-parser 靠它决定是否解析，
  // 漏了会让 express.json() 直接跳过（req.body 停在 {}），看起来像"事件字段丢了"。
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${base}${path}`, {
    method: init.method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  return { status: response.status, text: await response.text() }
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value: unknown = record[key]
  return typeof value === 'number' ? value : Number.NaN
}

/** 取嵌套对象字段（拿不到给空对象，调用侧只需判空即可） */
function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return toRecord(record[key])
}

/** unknown -> Record（拿不到给空对象） */
function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// ------------------------------------------------------------------ ④ 无答案判定

function testAnswerJudge(): void {
  console.log('\n[验收④] 无答案判定规则（judgeNoAnswer 三态）')

  check(
    '短语命中-知识库里没有',
    judgeNoAnswer({ answer: '知识库里没有关于量子计算的资料。', sources: ['某政策.pdf'] }) === true,
    '说"知识库里没有"即使带兜底来源也算无答案（短语优先）',
  )
  check(
    '短语命中-无法回答（全角+空白归一）',
    judgeNoAnswer({ answer: '　抱歉， 我 无法 回 答 这个问题 ', sources: [] }) === true,
    `归一化输入：${JSON.stringify(normalizeForMatch('　抱歉， 我 无法 回 答 这个问题 '))}`,
  )
  check(
    '短语命中-库内没有',
    judgeNoAnswer({ answer: '库内没有相关资料' }) === true,
    '"库内没有"命中',
  )
  check(
    '来源为空',
    judgeNoAnswer({ answer: '这是一段正常但没有引用的回答。', sources: [] }) === true,
    '有文字但 sources=[] -> 无答案（任务卡口径：来源为空算无答案）',
  )
  check(
    '来源为空（hasSource=false）',
    judgeNoAnswer({ answer: '这是一段回答。', hasSource: false }) === true,
    'hasSource=false -> 无答案',
  )
  check(
    '有答案（来源非空且未命中短语）',
    judgeNoAnswer({
      answer: '2019 年上海市生活垃圾分类实施方案要求……',
      sources: ['实施方案.pdf'],
    }) === false,
    '来源非空 -> 有答案',
  )
  check(
    '反例-免责话术不误判',
    judgeNoAnswer({
      answer: '本回答不包含个人信息，仅引用公开政策原文。',
      sources: ['政策原文.pdf'],
    }) === false,
    '"不包含个人信息"不应被当成无答案（短语表已收窄）',
  )
  check(
    '未判定-只有 answer 没有来源信息',
    judgeNoAnswer({ answer: '一段没有任何来源标记的回答' }) === null,
    '拿不到来源证据 -> null（不进无答案率分母）',
  )
  check(
    '未判定-只有问题',
    judgeNoAnswer({ question: '社区厨余堆肥怎么设计？' }) === null,
    '只有问题没有回答 -> null',
  )
  check('未判定-空 payload', judgeNoAnswer({}) === null, '空对象 -> null')
  check('未判定-payload 不是对象', judgeNoAnswer('abc') === null, '非对象 -> null')
  check('短语匹配空串不命中', matchesNoAnswerPhrase('') === false, '空回答不当成无答案')
}

// ------------------------------------------------------------------ 守卫单测

function testAdminToken(): void {
  console.log('\n[验收⑤] 管理员静态口令守卫（纯函数，不依赖 .env）')

  check(
    '未配置口令 -> 一律拒绝',
    verifyAdminToken('anything', { adminToken: null }) === false,
    '没有默认口令留后门',
  )
  check(
    '口令相等（含首尾空白）-> 放行',
    verifyAdminToken(' s3cret ', { adminToken: 's3cret' }) === true,
    '首尾空白容错后相等则放行',
  )
  check(
    '口令不等 -> 拒绝',
    verifyAdminToken('wrong', { adminToken: 's3cret' }) === false,
    '错误口令不放行',
  )
  const config = loadTrackAdminConfig()
  console.log(
    `  INFO  ADMIN_STATS_TOKEN ${config.adminToken === null ? '未配置（静态口令路径自动失效，走 isAdmin JWT）' : '已配置'}`,
  )
}

// ------------------------------------------------------------------ 口径换算单测

function testSummaryMath(): void {
  console.log('\n[验收③] 口径换算（toAsksSummary / toEventCounts）')

  check(
    '无答案率 = noAnswer / judged',
    toAsksSummary(3, 1, 2).noAnswerRate === 0.5,
    `3 问 / 1 无答案 / 2 已判定 -> ${toAsksSummary(3, 1, 2).noAnswerRate}`,
  )
  check(
    '未判定不进分母',
    toAsksSummary(3, 1, 2).unjudged === 1,
    `total=3 judged=2 -> unjudged=${toAsksSummary(3, 1, 2).unjudged}`,
  )
  check('judged=0 时无答案率给 0', toAsksSummary(2, 0, 0).noAnswerRate === 0, '不出现 NaN')
  const counts = toEventCounts([{ event: 'page_view', _count: { _all: 7 } }])
  check(
    '七类事件补齐（未发生的给 0）',
    counts.page_view === 7 && counts.search === 0 && counts.feedback_submit === 0,
    `page_view=7, search=0, feedback_submit=0`,
  )
}

// ------------------------------------------------------------------ ①③⑤ HTTP

async function testHttp(): Promise<void> {
  loadEnvFile()
  const app = createApp()
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    console.error('无法获取临时端口，自测中止')
    failed += 1
    return
  }
  const base = `http://127.0.0.1:${address.port}`
  const prisma = getPrisma()
  const sid = `selftest-track-${Date.now()}`
  const summaryUrl = '/api/admin/stats/summary'

  try {
    // ---- 基线（探针前）
    const baselineRaw = await call(base, summaryUrl, { method: 'GET' })
    check(
      '验收⑤ summary 无凭证 -> 401',
      baselineRaw.status === 401,
      `HTTP ${baselineRaw.status} ${baselineRaw.text.slice(0, 120)}`,
    )
    const wrongToken = await call(base, summaryUrl, {
      method: 'GET',
      headers: { 'X-Admin-Token': 'definitely-wrong' },
    })
    check(
      '验收⑤ summary 错口令 -> 401（回落 requireAuth）',
      wrongToken.status === 401,
      `HTTP ${wrongToken.status}`,
    )

    const before = await currentSummary()
    const beforeRows = await countEventsBySession(prisma, sid)
    check('探针前该 sessionId 无行', beforeRows === 0, `rows=${beforeRows}`)

    // ---- ① 单条
    const single = await call(base, '/api/track', {
      method: 'POST',
      body: {
        event: 'page_view',
        sessionId: sid,
        path: '/shelf?q=垃圾分类',
        payload: { referrer: '' },
      },
    })
    const singleBody = parseJson(single.text)
    check(
      '验收① POST /api/track 单条 -> 201 accepted=1',
      single.status === 201 && readNumber(singleBody, 'accepted') === 1,
      `HTTP ${single.status} ${single.text}`,
    )
    check(
      '验收① 单条落库行数 = 1',
      (await countEventsBySession(prisma, sid)) === 1,
      `rows=${await countEventsBySession(prisma, sid)}`,
    )

    // ---- ① 批量（裸数组，3 条里 1 条非法 -> 部分成功）
    const batch = await call(base, '/api/track', {
      method: 'POST',
      body: [
        { event: 'search', sessionId: sid, payload: { term: '垃圾分类', zeroResult: false } },
        { event: 'not_a_real_event', sessionId: sid, payload: {} },
        { event: 'ai_ask', sessionId: sid, payload: { question: '厨余怎么处理' } },
        { event: 'ai_ask', sessionId: sid, payload: { answer: '知识库里没有相关内容' } },
      ],
    })
    const batchBody = parseJson(batch.text)
    const rejected = batchBody['rejected']
    check(
      '验收① POST /api/track 批量 -> 201 accepted=3（1 条非法被拒）',
      batch.status === 201 && readNumber(batchBody, 'accepted') === 3,
      `HTTP ${batch.status} ${batch.text}`,
    )
    check(
      'rejected 给出下标与错误码',
      Array.isArray(rejected) && rejected.length === 1,
      JSON.stringify(rejected),
    )
    check(
      '验收① 批量落库行数 = 4（1 单 + 3 批）',
      (await countEventsBySession(prisma, sid)) === 4,
      `rows=${await countEventsBySession(prisma, sid)}`,
    )

    // ---- ① 包装信封 { events: [...] }
    const wrapped = await call(base, '/api/track', {
      method: 'POST',
      body: {
        events: [{ event: 'register', sessionId: sid, userId: null, payload: { selftest: true } }],
      },
    })
    check(
      '验收① { events:[...] } 包装信封也收',
      wrapped.status === 201 && readNumber(parseJson(wrapped.text), 'accepted') === 1,
      `HTTP ${wrapped.status} ${wrapped.text}`,
    )

    // ---- 信封级 400
    const empty = await call(base, '/api/track', { method: 'POST', body: [] })
    check('空数组 -> 400', empty.status === 400, `HTTP ${empty.status} ${empty.text}`)

    const tooMany = await call(base, '/api/track', {
      method: 'POST',
      body: Array.from({ length: 101 }, () => ({ event: 'page_view', sessionId: sid })),
    })
    check(
      '超 100 条 -> 400',
      tooMany.status === 400,
      `HTTP ${tooMany.status} ${tooMany.text.slice(0, 120)}`,
    )

    const allBad = await call(base, '/api/track', {
      method: 'POST',
      body: { event: 'not_a_real_event' },
    })
    check(
      '全部非法 -> 400（不落库）',
      allBad.status === 400,
      `HTTP ${allBad.status} ${allBad.text.slice(0, 160)}`,
    )

    const badEnvelope = await call(base, '/api/track', { method: 'POST', body: 'hello' })
    check(
      '原始值请求体（"hello"）-> 400 JSON 错误体',
      badEnvelope.status === 400 && parseJson(badEnvelope.text)['success'] === false,
      `HTTP ${badEnvelope.status} ${badEnvelope.text.slice(0, 160)}`,
    )

    const malformed = await fetch(`${base}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{不是 json',
    })
    const malformedText = await malformed.text()
    check(
      '畸形 JSON -> 400 JSON 错误体（不是 HTML 错误页）',
      malformed.status === 400 && parseJson(malformedText)['success'] === false,
      `HTTP ${malformed.status} ${malformedText.slice(0, 160)}`,
    )

    // ---- ③ 统计口径自检（用 ADMIN_STATS_TOKEN；未配置则跳过并提示）
    const token = loadTrackAdminConfig().adminToken
    if (token === null) {
      console.log('  SKIP  ADMIN_STATS_TOKEN 未配置 -> summary 数值核对由交付文档的 curl 验收承担')
    } else {
      const after = await call(base, summaryUrl, {
        method: 'GET',
        headers: { 'X-Admin-Token': token },
      })
      const summary = parseJson(after.text)
      const totals = readRecord(summary, 'totals')
      const asks = readRecord(summary, 'asks')
      const pvNow = readNumber(totals, 'pv')
      const eventsNow = readNumber(totals, 'events')
      check('验收③ summary 带口令 -> 200', after.status === 200, `HTTP ${after.status}`)
      check(
        '验收③ PV 增量 = 探针里的 page_view 数（1）',
        pvNow - before.pv === 1,
        `pv ${before.pv} -> ${pvNow}`,
      )
      check(
        '验收③ 事件总数增量 = 探针行数（5）',
        eventsNow - before.totalEvents === 5,
        `events ${before.totalEvents} -> ${eventsNow}`,
      )
      check(
        '验收③ 无答案率分子分母（asks）',
        readNumber(asks, 'total') === before.asks.total + 2 &&
          readNumber(asks, 'noAnswer') === before.asks.noAnswer + 1 &&
          readNumber(asks, 'judged') === before.asks.judged + 1,
        `asks ${JSON.stringify(before.asks)} -> ${JSON.stringify(asks)}`,
      )
      const topTerms = readRecord(summary, 'topSearchTerms')
      const termList: readonly unknown[] = Array.isArray(topTerms)
        ? (topTerms as readonly unknown[])
        : []
      check(
        '验收③ 检索词 Top10 命中探针词',
        termList.some((item) => {
          const row = toRecord(item)
          return row['term'] === '垃圾分类' && readNumber(row, 'count') >= 1
        }),
        JSON.stringify(termList.slice(0, 3)),
      )
    }

    // ---- 清理：探针事件删干净，不污染看板口径
    const cleaned = await deleteEventsBySession(prisma, sid)
    check(
      '自测探针已清理',
      cleaned === 5,
      `deleted=${cleaned}，剩余 rows=${await countEventsBySession(prisma, sid)}`,
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** 直接走服务层取基线（不带任何 HTTP 守卫，纯粹为了拿"探针前"的数字） */
async function currentSummary(): Promise<{
  readonly totalEvents: number
  readonly pv: number
  readonly asks: StatsSummaryResponse['asks']
}> {
  const summary = await buildStatsSummary(getPrisma())
  return { totalEvents: summary.totals.events, pv: summary.totals.pv, asks: summary.asks }
}

async function main(): Promise<void> {
  console.log('=== T07 track 自测 ===')
  testAnswerJudge()
  testAdminToken()
  testSummaryMath()
  await testHttp()
  console.log(`\n结果：PASS ${passed} / FAIL ${failed}`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[track.selftest] 自测异常：${detail}`)
    process.exitCode = 1
  })
  .finally(() => {
    void getPrisma().$disconnect()
  })
