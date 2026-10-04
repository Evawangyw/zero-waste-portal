// 契约：GET /api/docs/weknora 的响应体（T03 起该路径为「实时透传 WeKnora」的原始通道）
// ⚠️ T03 已把 `/api/docs` 改为书架查询（见 docs.shelf.types.ts 的 ShelfListResponse）。
// 验收：curl http://localhost:4000/api/docs/weknora => 200，JSON 数组，每项含 title 与 customMetadata。
// total 走响应头 X-Total-Count（成功体按任务卡要求是裸数组，不裹信封）。
// 边界：本文件只负责"把标题+元数据透出"；书架的筛选/排序在 docs.shelf.* 里。
import type { ListKnowledgeParams, WeKnoraErrorKind } from '../../weknora/index.js'

/** 单条资料的对外视图（字段名保持前端直接可用的 camelCase） */
export interface DocSummary {
  readonly id: string
  readonly title: string
  readonly fileName: string
  readonly fileType: string
  readonly fileSize: number
  readonly knowledgeBaseId: string
  /** 自定义元数据原样透出（年份/知识类型/知识领域/知识发布机构 等键） */
  readonly customMetadata: Readonly<Record<string, unknown>>
  readonly tags: readonly string[]
  readonly updatedAt: string
}

/** 列表查询入参（未识别参数一律忽略，避免 400 打断前端） */
export interface DocsQuery extends ListKnowledgeParams {
  readonly limit?: number | undefined
}

/** 出错时的响应体（成功时直接返回 DocSummary[] 数组，故这里单列） */
export interface DocsErrorResponse {
  readonly success: false
  readonly error: {
    readonly kind: WeKnoraErrorKind
    readonly message: string
  }
}
