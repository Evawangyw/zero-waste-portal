<script setup lang="ts">
// 基础导航条（T05：结构完整即可，不做美化）。
// 右侧显示登录态；登出后回首页。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { APP_NAME } from '../constants'
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
  void router.push('/')
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
  <el-header class="site-nav" height="auto">
    <div class="nav-left">
      <router-link to="/" class="brand">
        {{ APP_NAME }}
      </router-link>
      <nav class="nav-links">
        <router-link to="/" :class="{ active: isActive('/') }">首页</router-link>
        <router-link to="/foundation" :class="{ active: isActive('/foundation') }">基金会</router-link>
        <router-link to="/shelf" :class="{ active: isActive('/shelf') }">资料书架</router-link>
        <router-link v-if="isAdmin" to="/admin/stats" :class="{ active: isActive('/admin/stats') }">
          管理统计
        </router-link>
      </nav>
    </div>

    <div class="nav-right">
      <template v-if="isLoggedIn">
        <span class="user-name">{{ nickname }}，你好</span>
        <el-button size="small" @click="onLogout">退出登录</el-button>
      </template>
      <el-button v-else size="small" type="primary" plain @click="goAuth">登录 / 注册</el-button>
    </div>
  </el-header>
</template>

<style scoped>
.site-nav.el-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  flex-wrap: wrap;
  height: auto;
  min-height: 60px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
  background: #fff;
  --el-header-height: auto;
}

.nav-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 20px;
  min-width: 0;
}

.brand {
  flex: none;
  font-size: 18px;
  font-weight: 700;
  color: var(--el-color-primary);
  text-decoration: none;
  white-space: nowrap;
}

.nav-links {
  display: flex;
  flex: none;
  gap: 16px;
}

.nav-links a {
  color: var(--el-text-color-regular);
  text-decoration: none;
  padding: 4px 0;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}

.nav-links a.active {
  color: var(--el-color-primary);
  border-bottom-color: var(--el-color-primary);
}

.nav-right {
  display: flex;
  align-items: center;
  flex: none;
  gap: 12px;
}

.user-name {
  color: var(--el-text-color-regular);
  font-size: 14px;
}
</style>
