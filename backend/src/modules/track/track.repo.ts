// 模块边界：track（写库）
//
// 契约（对外经 index.ts 暴露）：
//   insertTrackEvents(prisma, inputs) -> number   （= 实际落库行数，验收①的判据）
//   deleteEventsBySession(prisma, sessionId) -> number  （自测清理用，正式流程不调）
//
// 只 import db 层，不碰 weknora / auth（铁律同 docs 书架层）。
// 批量写入放在一个交互式事务里：要么全落要么全不落，
// 保证「accepted == EventLog 实际行数」这条验收判据永远成立（中途失败不会留半截）。
import type { PrismaClient } from '@prisma/client'
import type { TrackEventInput } from './track.types.js'

/** 批量落库；返回落库行数（与入参条数相同，全成功才返回） */
export async function insertTrackEvents(
  prisma: PrismaClient,
  inputs: readonly TrackEventInput[],
): Promise<number> {
  if (inputs.length === 0) return 0
  await prisma.$transaction(async (tx) => {
    for (const input of inputs) {
      await tx.eventLog.create({
        data: {
          event: input.event,
          userId: input.userId,
          sessionId: input.sessionId,
          payload: input.payload,
          path: input.path,
          term: input.term,
          noAnswer: input.noAnswer,
          zeroResult: input.zeroResult,
        },
      })
    }
  })
  return inputs.length
}

/** 按会话标识删事件（track.selftest.ts 自测探针清理，避免污染看板口径） */
export async function deleteEventsBySession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<number> {
  const result = await prisma.eventLog.deleteMany({ where: { sessionId } })
  return result.count
}

/** 某会话已落库行数（自测断言用） */
export async function countEventsBySession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<number> {
  return prisma.eventLog.count({ where: { sessionId } })
}
