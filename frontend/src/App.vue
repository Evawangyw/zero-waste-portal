<script setup lang="ts">
// 应用外壳（T05）：导航条 + 路由出口 + 全局挂件初始化。
// 挂件是**全站**常驻（首页/书架/详情都有"试试问 AI"入口），故在 App.vue 统一初始化一次。
import { onMounted } from 'vue'
import SiteNav from './components/SiteNav.vue'
import { flushPendingQuery, mountWidget } from './composables/useWidget'
import { restoreAuth } from './composables/useAuth'
import { APP_NAME } from './constants'

onMounted(() => {
  // 登录态恢复：有 token 才拉 /me，失败不打断页面
  void restoreAuth()
  // 官方挂件（安全模式：publish token 只在后端）
  void mountWidget().then(() => {
    flushPendingQuery()
  })
})
</script>

<template>
  <el-container class="app-shell">
    <SiteNav />
    <el-main class="app-main">
      <router-view />
    </el-main>
    <el-footer class="app-footer" height="auto">
      <span>{{ APP_NAME }} · 资料仅供公众参考，具体执行以官方文件为准</span>
      <router-link class="footer-link" to="/foundation">基金会介绍</router-link>
    </el-footer>
  </el-container>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.app-main {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}

.app-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 16px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 16px;
}

.footer-link {
  color: var(--el-color-primary);
  text-decoration: none;
}
</style>
