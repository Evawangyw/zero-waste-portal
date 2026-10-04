// 登录态（前端唯一真相来源，模块级单例）。
//
// 为什么不用 pinia：本项目登录态就一个 JWT + 一个 user 对象，
// 为此引一个状态库不划算；模块级 reactive 足够，且组件间天然共享。
import { computed, reactive, readonly } from 'vue'
import { ApiError } from '../api/http'
import { me as fetchMe } from '../api/auth'
import type { PublicUser } from '../api/types'
import { TOKEN_STORAGE_KEY } from '../constants'

interface AuthState {
  /** JWT；null = 未登录 */
  token: string | null
  user: PublicUser | null
  /** 启动时是否已尝试过恢复登录态（避免路由守卫重复拉 /me） */
  restored: boolean
  loading: boolean
}

const state = reactive<AuthState>({
  token: readStoredToken(),
  user: null,
  restored: false,
  loading: false,
})

function readStoredToken(): string | null {
  try {
    const value = window.localStorage.getItem(TOKEN_STORAGE_KEY)
    return value !== null && value !== '' ? value : null
  } catch {
    // 隐私模式 / 禁用 storage：当作未登录，功能降级但不崩
    return null
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    else window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // 存不了就只在内存里活着，刷新后需重新登录
  }
}

export const isLoggedIn = computed(() => state.token !== null)
export const currentUser = computed(() => state.user)
export const authLoading = computed(() => state.loading)
export const authRestored = computed(() => state.restored)

/** 需要登录态的请求用它取 token */
export function authToken(): string | null {
  return state.token
}

/** 登录成功后调用 */
export function setAuth(token: string, user: PublicUser): void {
  state.token = token
  state.user = user
  state.restored = true
  writeStoredToken(token)
}

/** 登出（清内存 + 清 storage） */
export function clearAuth(): void {
  state.token = null
  state.user = null
  state.restored = true
  writeStoredToken(null)
}

/**
 * 恢复登录态：本地有 token 就拉一次 /me 验活。
 * - 401（token 失效/用户被删）-> 清登录态，当未登录处理；
 * - 网络错 -> 保留 token 不清（可能只是后端抖了一下），把 user 置 null 但仍算已登录。
 * 返回是否真的处在登录态，路由守卫拿它决定放行还是跳登录。
 */
export async function restoreAuth(): Promise<boolean> {
  if (state.restored) return state.token !== null
  if (state.token === null) {
    state.restored = true
    return false
  }
  state.loading = true
  try {
    const response = await fetchMe(state.token)
    state.user = response.user
    return true
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) clearAuth()
    return state.token !== null
  } finally {
    state.loading = false
    state.restored = true
  }
}

/** 只读快照（模板里直接 v-model 绑定时不暴露 set） */
export const authState = readonly(state)
