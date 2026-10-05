// 模块边界：track —— 对外唯一出口（T07 行为统计落库）
// 铁律同 auth/weknora：全项目只允许从本文件 import 本模块，禁止绕过它直连 track.repo / track.stats。
//
// 挂载点（src/app.ts）：app.use(trackRouter) —— 本卡动 app.ts 的唯一理由。
//   POST /api/track                前端埋点统一入口（单条/批量，匿名可传）
//   GET  /api/admin/stats/summary  管理员看板摘要（requireAdminAccess + requireAdminUser）
//
// 口径与契约：docs/task-cards/T07-契约.md（PRD 第八节 R04 基础版）

// ---- HTTP 契约
// 注：原先导出的 trackJsonErrorHandler 已由全局 jsonErrorHandler
// （src/middleware/json-error.handler.ts）接管并从 app.ts 移除，此处不再导出。
export { trackRouter } from './track.router.js'
export {
  ADMIN_TOKEN_HEADER,
  loadTrackAdminConfig,
  requireAdminAccess,
  requireAdminUser,
} from './track.admin.js'
export { parseTrackEnvelope, parseTrackItem } from './track.validate.js'
export type { EnvelopeParse, ItemParse } from './track.validate.js'

// ---- 无答案判定（验收④：规则写清 + 可自测）
export {
  judgeNoAnswer,
  matchesNoAnswerPhrase,
  normalizeForMatch,
  readAnswerEvidence,
} from './track.answer.js'
export type { AnswerEvidence } from './track.answer.js'

// ---- 落库与聚合（P2 看板/验收脚本按需直接调）
export { countEventsBySession, deleteEventsBySession, insertTrackEvents } from './track.repo.js'
export { STATS_TOP_LIMIT, buildStatsSummary, toAsksSummary, toEventCounts } from './track.stats.js'

// ---- 类型与常量
export {
  TRACK_EVENTS,
  TRACK_MAX_EVENTS_PER_REQUEST,
  TRACK_MAX_PATH_CHARS,
  TRACK_MAX_PAYLOAD_CHARS,
  TRACK_MAX_SESSION_ID_CHARS,
  TRACK_MAX_TERM_CHARS,
  TRACK_MAX_USER_ID_CHARS,
} from './track.types.js'
export type {
  AsksSummary,
  DownloadTopItem,
  SearchTermCount,
  StatsErrorKind,
  StatsErrorResponse,
  StatsSummaryResponse,
  TrackAcceptedResponse,
  TrackErrorResponse,
  TrackEvent,
  TrackEventInput,
  TrackIssue,
  TrackIssueCode,
} from './track.types.js'
