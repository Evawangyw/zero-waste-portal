<script setup lang="ts">
// 顶栏：对齐基金会官网——左侧标志与站名，右侧加粗导航，选中为主绿。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { APP_NAME } from '../constants'
import logoUrl from '../assets/foundation-mark.png'
import { authToken, clearAuth, currentUser, isLoggedIn } from '../composables/useAuth'

const route = useRoute()
const router = useRouter()

const nickname = computed(() => currentUser.value?.name ?? '')
const activePath = computed(() => route.path)

/** T08lite：管理统计入口只对管理员露出（普通用户连链接都看不到），判定依据是 /me 返回的 isAdmin */
const isAdmin = computed(() => currentUser.value?.isAdmin === true)

function onLogout(): void {
  clearAuth()
  ElMessage.success('已退出登录')
  void router.push({ name: 'intro' })
}

function goAuth(): void {
  const redirect = route.fullPath
  void router.push({ path: '/auth', query: redirect === '/' ? {} : { redirect } })
}

function isActive(path: string): boolean {
  if (path === '/') return activePath.value === '/'
  return activePath.value.startsWith(path)
}

// 模板里要用 token 的存在性（模板不能直接调函数里的 ref）——isLoggedIn 已是 computed
void authToken
</script>

<template>
  <header class="site-nav">
    <div class="nav-inner">
      <router-link to="/" class="brand">
        <img class="brand-mark" :src="logoUrl" alt="六尺巷基金会" />
        <span class="brand-text">
          <span class="brand-org">安徽省六尺巷慈善基金会</span>
          <span class="brand-name">{{ APP_NAME }}</span>
        </span>
      </router-link>

      <nav class="nav-links">
        <router-link to="/" :class="{ active: isActive('/') }">首页</router-link>
        <router-link v-if="isLoggedIn" to="/foundation" :class="{ active: isActive('/foundation') }">
          基金会
        </router-link>
        <router-link v-if="isLoggedIn" to="/shelf" :class="{ active: isActive('/shelf') }">
          资料书架
        </router-link>
        <router-link v-if="isAdmin" to="/admin/stats" :class="{ active: isActive('/admin/stats') }">
          管理统计
        </router-link>
      </nav>

      <div class="nav-right">
        <template v-if="isLoggedIn">
          <span class="user-name">{{ nickname }}，你好</span>
          <el-button size="small" @click="onLogout">退出登录</el-button>
        </template>
        <el-button v-else size="small" type="primary" @click="goAuth">登录 / 注册</el-button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.site-nav {
  position: sticky;
  top: 0;
  z-index: 40;
  background: rgba(246, 243, 234, 0.9);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(16px);
}

.nav-inner {
  display: flex;
  align-items: center;
  gap: 24px;
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 12px 28px;
  box-sizing: border-box;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  color: var(--zw-ink);
  text-decoration: none;
}

.brand-mark {
  width: 52px;
  height: 52px;
  object-fit: contain;
  flex: none;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.brand-org {
  color: var(--zw-muted);
  font-size: 12px;
  letter-spacing: 0.04em;
}

.brand-name {
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.2;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.nav-links a {
  color: #68716b;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 999px;
  white-space: nowrap;
}

.nav-links a.active,
.nav-links a:hover {
  background: #e8e9dc;
  color: var(--forest-deep);
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.user-name {
  max-width: 160px;
  overflow: hidden;
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  color: var(--ink);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 860px) {
  .nav-inner {
    flex-wrap: wrap;
    gap: 10px 16px;
  }

  .nav-links {
    order: 3;
    width: 100%;
    margin-left: 0;
    gap: 18px;
  }

  .nav-links a {
    font-size: 16px;
  }

  .brand-mark {
    width: 48px;
    height: 48px;
  }

  .brand-name {
    font-size: 17px;
  }
}
</style>
