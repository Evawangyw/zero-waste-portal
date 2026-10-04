// 契约（模块内）：PrismaClient 单例
// hot-reload（tsx watch）下反复 new 会耗连接，故挂 globalThis 复用。
import { PrismaClient } from '@prisma/client'

const GLOBAL_KEY = '__zeroWastePrisma__'

interface PrismaGlobal {
  [GLOBAL_KEY]?: PrismaClient
}

export function getPrisma(): PrismaClient {
  const g = globalThis as unknown as PrismaGlobal
  const existing = g[GLOBAL_KEY]
  if (existing !== undefined) return existing
  const created = new PrismaClient()
  g[GLOBAL_KEY] = created
  return created
}
