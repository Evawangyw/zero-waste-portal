// admin 通道（T08lite 管理统计最简页）：本卡唯一的取数出口。
//
// 只调 GET /api/admin/stats/summary（后端守卫见 backend/src/modules/track/track.admin.ts：
// 静态口令 X-Admin-Token 或 isAdmin 管理员 JWT；本页走 JWT 那条，前端不持有也不需要口令）。
//
// 三条硬约定：
//  1. 零后端改动：本文件不新增任何端点、参数、字段；
//  2. 零口径换算：PV/UV/无答案率等口径解释权全在后端 track.stats.ts，前端只按原值显示，
//     否则页面数字会和 curl summary 对不上，验收①没法逐条比；
//  3. 零图表库：返回体原样交给视图渲染。
import { request } from './http'
import type { StatsSummaryResponse } from './types'

/** GET /api/admin/stats/summary —— 看板摘要（**必须带管理员 JWT**，否则 401/403） */
export function fetchStatsSummary(token: string): Promise<StatsSummaryResponse> {
  return request<StatsSummaryResponse>('/admin/stats/summary', { token })
}
