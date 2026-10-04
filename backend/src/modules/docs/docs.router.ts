// 模块边界：docs
// 契约：GET /api/docs -> 200 { success, total, items:[{ id, title, customMetadata, ... }] }
// 实现：只允许经 weknora 对接层取数；本模块不做筛选/排序逻辑（T03 负责）。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { WeKnoraClient, WeKnoraError } from '../../weknora/index.js'
import type { DocsErrorResponse, DocsQuery, DocSummary } from './docs.types.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export const docsRouter: Router = Router()

docsRouter.get('/api/docs', (req: Request, res: Response) => {
  void handleDocs(req, res)
})

async function handleDocs(req: Request, res: Response): Promise<void> {
  const client = WeKnoraClient.fromEnv()
  const query = parseDocsQuery(req.query)
  try {
    const result = await client.listKnowledge({
      knowledgeBaseId: query.knowledgeBaseId,
      page: query.page,
      pageSize: query.limit,
      keyword: query.keyword,
      sortBy: query.sortBy,
      tagIds: query.tagIds,
    })
    const items: DocSummary[] = result.items.map((k) => ({
      id: k.id,
      title: k.title,
      fileName: k.fileName,
      fileType: k.fileType,
      fileSize: k.fileSize,
      knowledgeBaseId: k.knowledgeBaseId,
      customMetadata: k.customMetadata,
      tags: k.tags,
      updatedAt: k.updatedAt,
    }))
    // 成功体 = 裸数组（任务卡："返回测试库中文件的标题 JSON 数组"）；总数放响应头
    res.setHeader('X-Total-Count', String(result.total))
    res.status(200).json(items)
  } catch (err) {
    respondError(res, err)
  }
}

/**
 * query 解析：只认白名单键。
 * ⚠️ 缺失键必须真给 undefined —— 曾踩坑：String(undefined).split(',') 会得到 ['undefined']，
 * 下游 tag_ids=undefined 被 WeKnora 当真实标签过滤，列表直接空掉。
 */
function parseDocsQuery(raw: unknown): DocsQuery {
  const q = isRecord(raw) ? raw : {}
  const tagIdsRaw = readString(q['tagIds'])
  return {
    knowledgeBaseId: readString(q['knowledgeBaseId']),
    page: readInt(q['page'], 1),
    limit: Math.min(readInt(q['limit'], DEFAULT_LIMIT), MAX_LIMIT),
    keyword: readString(q['keyword']),
    sortBy: readString(q['sortBy']),
    tagIds: tagIdsRaw === undefined ? undefined : tagIdsRaw.split(','),
  }
}

/** 对接层错误 -> HTTP 状态码（前端能区分"未授权"与"引擎挂了"） */
function respondError(res: Response, err: unknown): void {
  const error = WeKnoraError.from(err, '/api/docs')
  const body: DocsErrorResponse = {
    success: false,
    error: { kind: error.kind, message: error.message },
  }
  res.status(statusFor(error.kind)).json(body)
}

/** 我方配置问题（401/403）对前端统一报 502，不泄露内网鉴权细节 */
function statusFor(kind: WeKnoraError['kind']): number {
  switch (kind) {
    case 'unauthorized':
    case 'forbidden':
      return 502
    case 'not_found':
      return 404
    case 'rate_limited':
      return 429
    case 'timeout':
      return 504
    case 'client_error':
    case 'parse_error':
      return 502
    case 'network':
    case 'server_error':
      return 503
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function readInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}
