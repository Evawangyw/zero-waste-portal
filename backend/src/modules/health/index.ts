// 模块边界：health —— 对外唯一出口
export { healthRouter } from './health.router.js'
export type { HealthResponse } from './health.types.js'
export { buildHealthResponse } from './health.types.js'
