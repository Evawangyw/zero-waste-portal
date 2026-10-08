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
import { judgeNoAnswer } from './track.answer.js'
import { TRACK_MAX_PAYLOAD_CHARS, TRACK_MAX_TERM_CHARS } from './track.types.js'
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

/** 回答回写：找到本会话里最近一条还没有 answer 的同题 ai_ask，补上正文并重算无答案。 */
export async function completeAskEvent(
  prisma: PrismaClient,
  input: {
    readonly sessionId: string
    readonly question: string
    readonly answer: string
    readonly weknoraSessionId: string
  },
): Promise<boolean> {
  const questionKey = normalizeQuestion(input.question)
  if (input.sessionId === '' || questionKey === '' || input.answer.trim() === '') return false

  const rows = await prisma.eventLog.findMany({
    where: { event: 'ai_ask', sessionId: input.sessionId },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { id: true, payload: true },
  })

  const target = rows.find((row) => {
    const payload = parsePayload(row.payload)
    if (typeof payload['answer'] === 'string') return false
    return normalizeQuestion(readQuestion(payload)) === questionKey
  })
  if (target === undefined) return false

  const previous = parsePayload(target.payload)
  const nextPayload = fitAskPayload(previous, input.answer, input.weknoraSessionId)
  await prisma.eventLog.update({
    where: { id: target.id },
    data: {
      payload: nextPayload,
      term: questionKey,
      noAnswer: judgeNoAnswer(JSON.parse(nextPayload) as unknown),
    },
  })
  return true
}

/** 提问归一，和检索词同一套折叠规则，让同一句话能对上刚写入的 ai_ask。 */
function normalizeQuestion(value: string): string {
  const collapsed = value.trim().replace(/\s+/gu, ' ').toLowerCase()
  return collapsed.length <= TRACK_MAX_TERM_CHARS
    ? collapsed
    : collapsed.slice(0, TRACK_MAX_TERM_CHARS)
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 坏 JSON 当空对象，这条对不上就跳过
  }
  return {}
}

function readQuestion(payload: Record<string, unknown>): string {
  const question = payload['question']
  return typeof question === 'string' ? question : ''
}

/** 回答可能很长；截到 payload 上限以内，并声明 hasSource 让无答案判定离开「未判定」。 */
function fitAskPayload(
  previous: Record<string, unknown>,
  answer: string,
  weknoraSessionId: string,
): string {
  let text = answer.trim()
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const body: Record<string, unknown> = {
      ...previous,
      answer: text,
      hasSource: text !== '',
    }
    if (weknoraSessionId !== '') body['weknoraSessionId'] = weknoraSessionId
    const serialized = JSON.stringify(body)
    if (serialized.length <= TRACK_MAX_PAYLOAD_CHARS) return serialized
    const overflow = serialized.length - TRACK_MAX_PAYLOAD_CHARS + 8
    text = text.slice(0, Math.max(0, text.length - overflow))
  }
  return JSON.stringify({
    question: readQuestion(previous),
    answer: '',
    hasSource: false,
  })
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
