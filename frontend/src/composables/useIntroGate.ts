/** 只接受站内绝对路径，拒绝 // 和外部地址。 */

export function safeInternalPath(value: unknown, fallback: string): string {
  const first: unknown = Array.isArray(value) ? value[0] : value
  if (typeof first !== 'string') return fallback
  if (!first.startsWith('/') || first.startsWith('//')) return fallback
  return first
}
