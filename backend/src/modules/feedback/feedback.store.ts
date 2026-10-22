import { getPrisma } from '../../db/prisma.js'
import { feedbackCategoryLabel } from './feedback.types.js'
import type {
  FeedbackCreateInput,
  FeedbackItem,
  FeedbackList,
  FeedbackStatus,
  FeedbackStatusFilter,
  FeedbackUserView,
} from './feedback.types.js'

const LIST_LIMIT = 200

/** 这张表不走 prisma db push：库里另有手写的 site_settings，push 会把它当成多余表删掉。 */
export async function ensureFeedbackTable(): Promise<void> {
  const prisma = getPrisma()
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "feedbacks" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "category" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "pagePath" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL DEFAULT 'open',
      "userId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "feedbacks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`,
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "feedbacks_createdAt_idx" ON "feedbacks"("createdAt")`,
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "feedbacks_status_idx" ON "feedbacks"("status")`,
  )
}

interface FeedbackUserRow {
  readonly id: string
  readonly name: string
  readonly org: string
  readonly phone: string
}

interface FeedbackRow {
  readonly id: string
  readonly category: string
  readonly description: string
  readonly pagePath: string
  readonly status: string
  readonly createdAt: Date
  readonly user: FeedbackUserRow | null
}

export async function createFeedback(
  input: FeedbackCreateInput,
  userId: string | null,
): Promise<{ readonly id: string }> {
  const created = await getPrisma().feedback.create({
    data: {
      category: input.category,
      description: input.description,
      pagePath: input.pagePath,
      userId,
    },
    select: { id: true },
  })
  return { id: created.id }
}

export async function listFeedback(filter: FeedbackStatusFilter): Promise<FeedbackList> {
  const prisma = getPrisma()
  const where = filter === 'all' ? {} : { status: filter }
  const [total, open, rows] = await Promise.all([
    prisma.feedback.count(),
    prisma.feedback.count({ where: { status: 'open' } }),
    prisma.feedback.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
      include: {
        user: { select: { id: true, name: true, org: true, phone: true } },
      },
    }),
  ])
  return { total, open, items: rows.map(toItem) }
}

export async function setFeedbackStatus(
  id: string,
  status: FeedbackStatus,
): Promise<FeedbackItem | null> {
  const prisma = getPrisma()
  const existing = await prisma.feedback.findUnique({ where: { id }, select: { id: true } })
  if (existing === null) return null
  const row = await prisma.feedback.update({
    where: { id },
    data: { status },
    include: {
      user: { select: { id: true, name: true, org: true, phone: true } },
    },
  })
  return toItem(row)
}

function toItem(row: FeedbackRow): FeedbackItem {
  return {
    id: row.id,
    category: row.category,
    categoryLabel: feedbackCategoryLabel(row.category),
    description: row.description,
    pagePath: row.pagePath,
    status: row.status === 'done' ? 'done' : 'open',
    createdAt: row.createdAt.toISOString(),
    user: toUser(row.user),
  }
}

function toUser(user: FeedbackUserRow | null): FeedbackUserView | null {
  if (user === null) return null
  return { id: user.id, name: user.name, org: user.org, phone: user.phone }
}
