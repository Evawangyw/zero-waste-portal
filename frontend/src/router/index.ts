// 前端路由（T05）。公众页 + 兜底 404，全部懒加载之外的直接引入（本项目页面少，直接引入更利于排障）。
//
// 登录后先到关于页。书架可以先翻。资料详情、下载和 AI 助手需要登录。
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { restoreAuth } from '../composables/useAuth'
import { trackPageView } from '../composables/useTracking'
import HomeView from '../views/HomeView.vue'
import FoundationView from '../views/FoundationView.vue'
import ShelfView from '../views/ShelfView.vue'
import DocDetailView from '../views/DocDetailView.vue'
import AuthView from '../views/AuthView.vue'
import IntroView from '../views/IntroView.vue'
import AdminShell from '../views/admin/AdminShell.vue'
import AdminDocsView from '../views/admin/AdminDocsView.vue'
import AdminUsersView from '../views/admin/AdminUsersView.vue'
import AdminSettingsView from '../views/admin/AdminSettingsView.vue'
import AdminStatsView from '../views/AdminStatsView.vue'
import ProfileView from '../views/ProfileView.vue'
import NotFoundView from '../views/NotFoundView.vue'

const routes: readonly RouteRecordRaw[] = [
  {
    path: '/',
    name: 'about',
    component: FoundationView,
    meta: { title: '关于零废弃知识库' },
  },
  { path: '/foundation', redirect: '/' },
  {
    path: '/ask',
    name: 'ask',
    component: HomeView,
    meta: { title: 'AI助手', requiresAuth: true },
  },
  {
    path: '/shelf',
    name: 'shelf',
    component: ShelfView,
    meta: { title: '资料书架' },
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
    path: '/me',
    name: 'profile',
    component: ProfileView,
    meta: { title: '个人主页', requiresAuth: true },
  },
  {
    // 管理区。不在路由层重定向未登录的人，外壳里给出登录或权限提示。
    path: '/admin',
    component: AdminShell,
    meta: { title: '管理' },
    children: [
      { path: '', redirect: { name: 'admin-stats' } },
      {
        path: 'docs',
        name: 'admin-docs',
        component: AdminDocsView,
        meta: { title: '资料管理' },
      },
      {
        path: 'users',
        name: 'admin-users',
        component: AdminUsersView,
        meta: { title: '注册信息' },
      },
      {
        path: 'stats',
        name: 'admin-stats',
        component: AdminStatsView,
        meta: { title: '数据看板' },
      },
      {
        path: 'settings',
        name: 'admin-settings',
        component: AdminSettingsView,
        meta: { title: '系统设置' },
      },
    ],
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
  const loggedIn = await restoreAuth()

  // 开场介绍只给未登录的人。登录后再打开，回到关于页。
  if (loggedIn && to.name === 'intro') return { path: '/' }
  // 未登录打开关于页，先看开场介绍。
  if (!loggedIn && to.name === 'about') return { name: 'intro' }

  if (to.meta['requiresAuth'] !== true) return true
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
