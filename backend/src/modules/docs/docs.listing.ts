// 模块边界：docs（上下架）
// 契约：
//   queryAdminShelf()  管理员看全部资料，可按标题搜索、按上架状态筛选
//   setDocListed()     上架或下架；找不到返回 null
//   isDocListed()      true 上架 / false 下架 / null 不在索引里
import type { Prisma, PrismaClient } from '@prisma/client'

import { getPrisma } from '../../db/prisma.js'

export const ADMIN_SHELF_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50

export interface AdminShelfItem {
  readonly id: string
  readonly title: string
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly listed: boolean
}

export interface AdminShelfPage {
  readonly success: true
  readonly items: readonly AdminShelfItem[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

export async function queryAdminShelf(
  input: { readonly q: string; readonly listed: boolean | null; readonly page: number; readonly pageSize: number },
  prisma: PrismaClient = getPrisma(),
): Promise<AdminShelfPage> {
  const pageSize = clampPageSize(input.pageSize)
  const page = input.page < 1 ? 1 : input.page
  const where = buildWhere(input.q, input.listed)
  const [total, rows] = await Promise.all([
    prisma.knowledgeIndex.count({ where }),
    prisma.knowledgeIndex.findMany({
      where,
      orderBy: [{ title: 'asc' }, { knowledgeId: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        knowledgeId: true,
        title: true,
        readableTitle: true,
        year: true,
        org: true,
        docType: true,
        listed: true,
      },
    }),
  ])
  return {
    success: true,
    items: rows.map((row) => ({
      id: row.knowledgeId,
      title: row.readableTitle.trim() === '' ? row.title : row.readableTitle,
      year: row.year,
      org: row.org,
      docType: row.docType,
      listed: row.listed,
    })),
    total,
    page,
    pageSize,
  }
}

export async function setDocListed(
  id: string,
  listed: boolean,
  prisma: PrismaClient = getPrisma(),
): Promise<AdminShelfItem | null> {
  const updated = await prisma.knowledgeIndex.updateMany({
    where: { knowledgeId: id },
    data: { listed },
  })
  if (updated.count === 0) return null
  const row = await prisma.knowledgeIndex.findUnique({
    where: { knowledgeId: id },
    select: {
      knowledgeId: true,
      title: true,
      readableTitle: true,
      year: true,
      org: true,
      docType: true,
      listed: true,
    },
  })
  if (row === null) return null
  return {
    id: row.knowledgeId,
    title: row.readableTitle.trim() === '' ? row.title : row.readableTitle,
    year: row.year,
    org: row.org,
    docType: row.docType,
    listed: row.listed,
  }
}

/** null = 索引里没有这条，调用方按原来的「未收录」处理。 */
export async function isDocListed(
  id: string,
  prisma: PrismaClient = getPrisma(),
): Promise<boolean | null> {
  const row = await prisma.knowledgeIndex.findUnique({
    where: { knowledgeId: id },
    select: { listed: true },
  })
  return row === null ? null : row.listed
}

function buildWhere(q: string, listed: boolean | null): Prisma.KnowledgeIndexWhereInput {
  const where: Prisma.KnowledgeIndexWhereInput = {}
  if (listed !== null) where.listed = listed
  const text = q.trim()
  if (text !== '') {
    where.OR = [
      { title: { contains: text } },
      { readableTitle: { contains: text } },
      { fileName: { contains: text } },
      { org: { contains: text } },
    ]
  }
  return where
}

function clampPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1) return ADMIN_SHELF_PAGE_SIZE
  return Math.min(pageSize, MAX_PAGE_SIZE)
}
