// 前端路由（T05）。公众页 + 兜底 404，全部懒加载之外的直接引入（本项目页面少，直接引入更利于排障）。
//
// 登录守卫：书架和资料详情需要登录。未登录访问会去登录页，并带 redirect 回来。
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { restoreAuth } from '../composables/useAuth'
import { hasSeenIntro, safeInternalPath } from '../composables/useIntroGate'
import { trackPageView } from '../composables/useTracking'
import HomeView from '../views/HomeView.vue'
import FoundationView from '../views/FoundationView.vue'
import ShelfView from '../views/ShelfView.vue'
import DocDetailView from '../views/DocDetailView.vue'
import AuthView from '../views/AuthView.vue'
import IntroView from '../views/IntroView.vue'
import AdminStatsView from '../views/AdminStatsView.vue'
import NotFoundView from '../views/NotFoundView.vue'

const routes: readonly RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '首页' } },
  {
    path: '/foundation',
    name: 'foundation',
    component: FoundationView,
    meta: { title: '基金会介绍' },
  },
  {
    path: '/shelf',
    name: 'shelf',
    component: ShelfView,
    meta: { title: '资料书架', requiresAuth: true },
  },
  {
    path: '/doc/:id',
    name: 'doc-detail',
    component: DocDetailView,
    meta: { title: '资料详情', requiresAuth: true },
  },
  {
    path: '/auth',
    name: 'auth',
    component: AuthView,
    meta: { title: '登录 / 注册' },
    // 支持 /auth?redirect=/doc/xxx：登录后回跳原页面（详情页下载未登录时用）
    props: true,
  },
  {
    // 注册前的知识库介绍。meta.bare 让外壳藏起顶栏和页脚，整屏播放。
    path: '/intro',
    name: 'intro',
    component: IntroView,
    meta: { title: '知识库介绍', bare: true },
  },
  {
    // T08lite 管理统计最简页。meta.requiresAdmin 只是**声明式标记**：
    // 本页不在路由层放守卫 —— 卡片要求非管理员访问时「看到权限提示页」而不是被重定向，
    // 所以权限判定放在 AdminStatsView 内部（校验中/未登录/非管理员 三态各自提示）。
    path: '/admin/stats',
    name: 'admin-stats',
    component: AdminStatsView,
    meta: { title: '管理统计', requiresAdmin: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundView,
    meta: { title: '页面不存在' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes: [...routes],
  scrollBehavior: () => ({ top: 0 }),
})

function guestNeedsIntro(toPathName: string | symbol | undefined | null): boolean {
  return toPathName === 'home' || toPathName === 'auth'
}

/** 未登录、本会话还没看过介绍时，先去介绍页，并带上原本要去的登录回跳。 */
function introRedirect(
  next: '/' | '/auth',
  redirect: string | undefined,
): { name: 'intro'; query: Record<string, string> } {
  const query: Record<string, string> = { next }
  if (redirect !== undefined && redirect !== '') query['redirect'] = redirect
  return { name: 'intro', query }
}

router.beforeEach(async (to) => {
  if (to.name === 'intro') return true
  if (to.query['skipIntro'] === '1') return true

  if (to.meta['requiresAuth'] === true) {
    const loggedIn = await restoreAuth()
    if (loggedIn) return true
    if (!hasSeenIntro()) return introRedirect('/auth', to.fullPath)
    return { path: '/auth', query: { redirect: to.fullPath } }
  }

  if (!guestNeedsIntro(to.name)) return true
  const loggedIn = await restoreAuth()
  if (loggedIn || hasSeenIntro()) return true
  const next = to.name === 'auth' ? '/auth' : '/'
  const redirectQuery = to.query['redirect']
  const redirect =
    redirectQuery === undefined ? undefined : safeInternalPath(redirectQuery, '')
  return introRedirect(next, redirect === '' ? undefined : redirect)
})

router.afterEach((to, from) => {
  const title = typeof to.meta['title'] === 'string' ? to.meta['title'] : ''
  document.title = title === '' ? '零废弃知识库' : `${title} · 零废弃知识库`

  // T07 埋点：PV 只按「页面（path）变化」计一次。
  // from.matched 为空 = 首次进入（vue-router 的 START_LOCATION），这一次必须计；
  // 只改 query（书架筛选/搜索/分页）不重复计 PV，但 fullPath 仍原样带进 payload 与 path 列，
  // 这样看板既能算页面访问量，也能还原「在哪一页搜了什么」。
  if (from.matched.length === 0 || from.path !== to.path) {
    void trackPageView(to.fullPath, to.path, from.fullPath)
  }
})
