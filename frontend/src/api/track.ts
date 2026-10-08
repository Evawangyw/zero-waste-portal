// 埋点通道（T07）：POST /api/track 的唯一出口。
//
// 设计原则（与后端 docs/task-cards/T07-契约.md 对齐）：
//  - **fire-and-forget**：埋点失败绝不影响用户操作（发不出去就吞掉，只在控制台留一行 warn）；
//  - **不上报 JWT**：/api/track 不做服务端鉴权（公众侧匿名行为），没必要把登录凭证发到一个
//    公开的统计接口上。userId 只是一个 cuid，作为统计维度直接放在 body 里（P2 收紧时再加头）。
//  - 本文件只管传输；会话标识 / 登录用户 / 各页面语义由 composables/useTracking.ts 组装。
import { request } from './http'
import type { TrackAcceptedResponse, TrackEventName } from './types'

/** 一条待上报事件（字段名与后端契约 §3 一一对应） */
export interface TrackEventInput {
  readonly event: TrackEventName
  /** 会话标识；缺省由调用方（useTracking）填 */
  readonly sessionId?: string
  /** 用户 ID；null/缺省 = 匿名访客 */
  readonly userId?: string | null
  /** 页面来源（路由 fullPath） */
  readonly path?: string
  /** 事件载荷（普通对象；后端限 4000 字符） */
  readonly payload?: Readonly<Record<string, unknown>>
}

/**
 * 上报一条事件。
 * @returns 永远 resolve（失败也 resolve），调用方直接 `void trackEvent(...)` 即可。
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  await send({
    event: input.event,
    sessionId: input.sessionId,
    userId: input.userId,
    path: input.path,
    payload: input.payload,
  })
}

/** 批量上报（一次请求多条，省往返；后端单次上限 100 条） */
export async function trackBatch(inputs: readonly TrackEventInput[]): Promise<void> {
  if (inputs.length === 0) return
  const body = inputs.map((input) => ({
    event: input.event,
    sessionId: input.sessionId,
    userId: input.userId,
    path: input.path,
    payload: input.payload,
  }))
  await send(body.length === 1 ? body[0] : body)
}

/** 回答落地后回写已有的 ai_ask。updated=false 表示问题行还没写上，调用方可以再试。 */
export async function trackAskAnswer(input: {
  readonly sessionId: string
  readonly question: string
  readonly answer: string
  readonly weknoraSessionId: string
}): Promise<boolean> {
  try {
    const result = await request<{ readonly success: boolean; readonly updated: boolean }>(
      '/track/ask-answer',
      { method: 'POST', body: input },
    )
    return result.updated
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`[track] 回答回写失败（已忽略）：${detail}`)
    return false
  }
}

async function send(body: unknown): Promise<void> {
  try {
    await request<TrackAcceptedResponse>('/track', { method: 'POST', body })
  } catch (err) {
    // 埋点是旁路：网络抖动/后端 500 都不该在控制台刷红，只留一行便于排障
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`[track] 埋点上报失败（已忽略）：${detail}`)
  }
}
