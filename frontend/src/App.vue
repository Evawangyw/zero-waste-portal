<script setup lang="ts">
// 应用外壳（T05）：导航条 + 路由出口 + 全局挂件初始化。
// 挂件是**全站**常驻（首页/书架/详情都有"试试问 AI"入口），故在 App.vue 统一初始化一次。
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SiteNav from './components/SiteNav.vue'
import { dismissWidget, flushPendingQuery, mountWidget } from './composables/useWidget'
import { isLoggedIn, restoreAuth } from './composables/useAuth'
import { APP_NAME } from './constants'

const route = useRoute()
const router = useRouter()
const bare = computed(() => route.meta['bare'] === true)

onMounted(() => {
  // 登录态恢复：有 token 才拉 /me，失败不打断页面
  void restoreAuth()
})

// 人已经在首页时退出，路由不会重新进入守卫，这里补一次，回到知识库介绍。
watch(isLoggedIn, (loggedIn) => {
  if (!loggedIn && route.name === 'home') {
    void router.replace({ name: 'intro' })
  }
})

// AI 问答挂件只在登录后出现。登出立刻拆掉，避免未登录访客还能点右下角提问。
watch(
  [isLoggedIn, bare],
  ([loggedIn, isBare]) => {
    if (loggedIn && !isBare) {
      void mountWidget().then(() => {
        flushPendingQuery()
      })
      return
    }
    dismissWidget()
  },
  { immediate: true },
)
</script>

<template>
  <el-container class="app-shell">
    <SiteNav v-if="!bare" />
    <el-main class="app-main" :class="{ 'app-main-bare': bare }">
      <router-view />
    </el-main>
    <el-footer v-if="!bare" class="app-footer" height="auto">
      <div class="footer-inner">
        <div>
          <p class="footer-name">{{ APP_NAME }}</p>
          <p>安徽省六尺巷慈善基金会</p>
          <p class="footer-motto">六尺归心、礼让自然</p>
        </div>
        <nav class="footer-links">
          <router-link to="/">首页</router-link>
          <router-link v-if="isLoggedIn" to="/foundation">基金会介绍</router-link>
          <router-link v-if="isLoggedIn" to="/shelf">资料书架</router-link>
          <a href="https://www.lcx-foundation.org.cn/" target="_blank" rel="noopener noreferrer">
            基金会官网
          </a>
        </nav>
        <div>
          <p>地址：安徽省合肥市蜀山区潜山南路卓誉中心 2303</p>
          <p>
            邮箱：
            <a href="mailto:info@lcx-foundation.org.cn">info@lcx-foundation.org.cn</a>
          </p>
          <p>皖ICP备2025104469号-1</p>
        </div>
      </div>
      <p class="footer-note">{{ APP_NAME }} · 资料仅供公众参考，具体执行以官方文件为准</p>
    </el-footer>
  </el-container>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: #fff;
}

.app-main {
  width: 100%;
  max-width: var(--zw-content);
  margin: 0 auto;
  padding: 28px 16px 48px;
  box-sizing: border-box;
}

.app-main-bare {
  max-width: none;
  margin: 0;
  padding: 0;
}

.app-footer {
  --el-footer-padding: 0;
  --el-footer-height: auto;
  height: auto;
  padding: 36px 16px 24px;
  background: var(--zw-footer);
  color: var(--zw-footer-text);
  font-size: 13px;
  line-height: 1.7;
}

.footer-inner {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr 1.4fr;
  gap: 24px;
  width: 100%;
  max-width: var(--zw-content);
  margin: 0 auto;
}

.footer-inner p {
  margin: 0;
}

.footer-name {
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}

.footer-motto {
  margin-top: 8px;
  color: #fff;
  letter-spacing: 0.08em;
}

.footer-links {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.footer-links a,
.footer-inner a {
  color: var(--zw-footer-text);
  text-decoration: none;
}

.footer-links a:hover,
.footer-inner a:hover {
  color: #fff;
}

.footer-note {
  max-width: var(--zw-content);
  margin: 20px auto 0;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  color: #a8a8a8;
  font-size: 12px;
}

@media (max-width: 800px) {
  .footer-inner {
    grid-template-columns: 1fr;
  }
}
</style>
