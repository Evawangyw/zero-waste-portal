// 模块边界：track（T07 行为统计落库 · 路由）
//
// 契约：
//   POST /api/track              -> 201 { success:true, accepted, rejected[] }
//                                -> 400 { success:false, error:{ code, message, issues[] } }
//                                   -> 500 落库失败
//   GET  /api/admin/stats/summary-> 200 StatsSummaryResponse
//                                -> 401 / 403 守卫（见 track.admin.ts）
//                                   -> 500 统计查询失败
//
// 实现要点：
//  - 埋点是「尽力而为」的旁路：任何一条非法事件都不影响同批的合法事件（逐条校验、允许部分成功），
//    但信封不可用（不是对象/数组、空数组、超 100 条、全部非法）才整批 400。
//  - accepted 严格等于本次实际落库行数（写库在一个事务里，见 track.repo.ts）。
//  - 路由与 /api/docs/*、/api/auth/*、/api/ask、/api/embed/* 全不重叠，挂在最后即可。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { getPrisma } from '../../db/prisma.js'
import { requireAdminAccess, requireAdminUser } from './track.admin.js'
import { insertTrackEvents } from './track.repo.js'
import { buildStatsSummary } from './track.stats.js'
import { parseTrackEnvelope, parseTrackItem } from './track.validate.js'
import type {
  StatsErrorResponse,
  StatsSummaryResponse,
  TrackAcceptedResponse,
  TrackErrorResponse,
  TrackIssue,
} from './track.types.js'
import type { TrackEventInput } from './track.types.js'

export const trackRouter: Router = Router()

// ------------------------------------------------------------------ POST /api/track

trackRouter.post('/api/track', (req: Request, res: Response) => {
  void handleTrack(req, res)
})

async function handleTrack(req: Request, res: Response): Promise<void> {
  const envelope = parseTrackEnvelope(req.body)
  if (!envelope.ok) {
    respondTrackError(res, 400, 'VALIDATION_FAILED', envelope.issue.message, [envelope.issue])
    return
  }

  const accepted: TrackEventInput[] = []
  const rejected: TrackIssue[] = []
  envelope.items.forEach((raw, index) => {
    const parsed = parseTrackItem(raw, index)
    if (parsed.ok) accepted.push(parsed.value)
    else rejected.push(parsed.issue)
  })

  if (accepted.length === 0) {
    respondTrackError(
      res,
      400,
      'VALIDATION_FAILED',
      `本批 ${rejected.length} 条事件全部非法，未落库`,
      rejected,
    )
    return
  }

  try {
    const inserted = await insertTrackEvents(getPrisma(), accepted)
    const body: TrackAcceptedResponse = { success: true, accepted: inserted, rejected }
    res.status(201).json(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[track] 事件落库失败（${accepted.length} 条）：${detail}`)
    respondTrackError(res, 500, 'INTERNAL_ERROR', '埋点写入失败（详见服务端日志）', [])
  }
}

function respondTrackError(
  res: Response,
  status: number,
  code: 'VALIDATION_FAILED' | 'INTERNAL_ERROR',
  message: string,
  issues: readonly TrackIssue[],
): void {
  const body: TrackErrorResponse = {
    success: false,
    error: { code, message, issues },
  }
  res.status(status).json(body)
}

// ------------------------------------------------------------------ 兜底错误体

/**
 * 「body-parser 在进路由之前就报错」的情况（畸形 JSON、strict 模式下把 `"hello"` / `123`
 * 这类原始值判为非法）由**全局** jsonErrorHandler 兜住（见 src/middleware/json-error.handler.ts）。
 *
 * QA-01 P1-3 之前这里有个只拦 /api/track 的 trackJsonErrorHandler；那张修单把同一套信封
 * 提到了 app.ts 全局，本函数被它完整覆盖，故删除以免两份实现漂移。
 * 信封的 code / message / issues 结构保持不变，T07 契约行为不变。
 */

// ------------------------------------------------------------------ GET /api/admin/stats/summary

trackRouter.get(
  '/api/admin/stats/summary',
  requireAdminAccess,
  requireAdminUser,
  (_req: Request, res: Response) => {
    void handleSummary(res)
  },
)

async function handleSummary(res: Response): Promise<void> {
  try {
    const summary: StatsSummaryResponse = await buildStatsSummary(getPrisma())
    res.status(200).json(summary)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[track] 统计聚合失败：${detail}`)
    const body: StatsErrorResponse = {
      success: false,
      error: { kind: 'internal', message: '统计聚合失败（详见服务端日志）' },
    }
    res.status(500).json(body)
  }
}
