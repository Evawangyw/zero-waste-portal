// 前端路由（T05）。公众页 + 兜底 404，全部懒加载之外的直接引入（本项目页面少，直接引入更利于排障）。
//
// 登录守卫：书架和资料详情需要登录。未登录访问会去登录页，并带 redirect 回来。
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { restoreAuth } from '../composables/useAuth'
import { trackPageView } from '../composables/useTracking'
import HomeView from '../views/HomeView.vue'
import FoundationView from '../views/FoundationView.vue'
import ShelfView from '../views/ShelfView.vue'
import DocDetailView from '../views/DocDetailView.vue'
import AuthView from '../views/AuthView.vue'
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

router.beforeEach(async (to) => {
  if (to.meta['requiresAuth'] !== true) return true
  const loggedIn = await restoreAuth()
  if (loggedIn) return true
  return { path: '/auth', query: { redirect: to.fullPath } }
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
