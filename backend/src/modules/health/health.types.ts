// 契约：GET /health 的响应体
// 验收命令：curl http://localhost:4000/health  =>  {"ok":true}
export interface HealthResponse {
  readonly ok: boolean
}

/** 构造健康检查响应（显式返回字面量，避免多余字段影响验收比对） */
export function buildHealthResponse(): HealthResponse {
  return { ok: true }
}
