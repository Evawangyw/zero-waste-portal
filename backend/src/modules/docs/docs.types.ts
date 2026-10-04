// 契约：GET /api/docs 的响应体
// 验收：curl http://localhost:4000/api/docs => 200，JSON 数组，含 title 与 custom_metadata。
// 边界（任务卡）：本卡只做"把标题+元数据透出"，书架的筛选/排序是 T03 的事。
import type { ListKnowledgeParams } from '../../weknora/index.js'

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

export interface DocsResponse {
  readonly success: boolean
  readonly total: number
  readonly items: readonly DocSummary[]
}
