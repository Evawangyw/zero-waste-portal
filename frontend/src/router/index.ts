// 前端路由（T05）。四页 + 兜底 404，全部懒加载之外的直接引入（本项目页面少，直接引入更利于排障）。
//
// 登录守卫：只保护「详情页下载」那一步，不在路由层拦整页 ——
// PRD 要求公众可免登录浏览书架与详情，只有下载/（可选）提问才要登录，
// 所以下载按钮内部跳登录并带 redirect 回跳，路由守卫保持轻。
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import ShelfView from '../views/ShelfView.vue'
import DocDetailView from '../views/DocDetailView.vue'
import AuthView from '../views/AuthView.vue'
import NotFoundView from '../views/NotFoundView.vue'

const routes: readonly RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '首页' } },
  { path: '/shelf', name: 'shelf', component: ShelfView, meta: { title: '资料书架' } },
  { path: '/doc/:id', name: 'doc-detail', component: DocDetailView, meta: { title: '资料详情' } },
  {
    path: '/auth',
    name: 'auth',
    component: AuthView,
    meta: { title: '登录 / 注册' },
    // 支持 /auth?redirect=/doc/xxx：登录后回跳原页面（详情页下载未登录时用）
    props: true,
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

router.afterEach((to) => {
  const title = typeof to.meta['title'] === 'string' ? to.meta['title'] : ''
  document.title = title === '' ? '零废弃知识库' : `${title} · 零废弃知识库`
})
