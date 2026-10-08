/**
 * 注册前介绍的「本会话已看过」标记。
 * 只写 sessionStorage。刷新同一标签会再看一次；看完、跳过、去注册都会记下。
 * 存储不可用时视为已看过，避免首页和介绍页来回跳。
 */

const INTRO_SEEN_KEY = 'zw-intro-seen'

export function hasSeenIntro(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

export function markIntroSeen(): void {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, '1')
  } catch {
    // 存不下就只靠本次导航上的 skipIntro，不打断进入网站
  }
}

/** 只接受站内绝对路径，拒绝 // 和外部地址。 */
export function safeInternalPath(value: unknown, fallback: string): string {
  const first: unknown = Array.isArray(value) ? value[0] : value
  if (typeof first !== 'string') return fallback
  if (!first.startsWith('/') || first.startsWith('//')) return fallback
  return first
}
