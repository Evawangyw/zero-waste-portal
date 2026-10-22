<script setup lang="ts">
// 管理区外壳：左侧五个子页。未登录和非管理员停在提示页，不跳走。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currentUser, isLoggedIn, restoreAuth } from '../../composables/useAuth'

const route = useRoute()
const router = useRouter()

const authChecked = ref(false)
const authUnverified = ref(false)
const isAdmin = computed(() => currentUser.value?.isAdmin === true)
const showPanel = computed(() => authChecked.value && isAdmin.value && !authUnverified.value)

const items = [
  { to: '/admin/docs', title: '资料管理', note: '上传、上下架与导出' },
  { to: '/admin/users', title: '注册信息', note: '谁在用这个站' },
  { to: '/admin/stats', title: '数据看板', note: '访问与使用明细' },
  { to: '/admin/feedback', title: '问题反馈', note: '用户提交的问题' },
  { to: '/admin/settings', title: '系统设置', note: '问答模型和用户权限' },
] as const

onMounted(async () => {
  await restoreAuth()
  authChecked.value = true
  authUnverified.value = isLoggedIn.value && currentUser.value === null
})

function isCurrent(path: string): boolean {
  return route.path === path
}

function goAuth(): void {
  void router.push({ path: '/auth', query: { redirect: route.fullPath } })
}

function goHome(): void {
  void router.push('/')
}
</script>

<template>
  <el-card v-if="!showPanel" shadow="never" class="deny-card">
    <el-result v-if="!authChecked" icon="info" title="正在校验登录态…" sub-title="稍等一下，马上就好" />
    <el-result
      v-else-if="!isLoggedIn"
      icon="warning"
      title="需要登录后访问"
      sub-title="管理页只对登录用户开放，登录后再回来即可。"
    >
      <template #extra>
        <el-space>
          <el-button type="primary" @click="goAuth">去登录</el-button>
          <el-button @click="goHome">回首页</el-button>
        </el-space>
      </template>
    </el-result>
    <el-result
      v-else-if="authUnverified"
      icon="error"
      title="无法校验管理员身份"
      sub-title="本机后端 /api/auth/me 暂时不可用，刷新页面重试。"
    >
      <template #extra>
        <el-button @click="goHome">回首页</el-button>
      </template>
    </el-result>
    <el-result
      v-else
      icon="error"
      title="需要管理员权限"
      sub-title="当前账号不是管理员，看不到管理页。如需开通，请让运维用 admin:promote 把该账号提为管理员。"
    >
      <template #extra>
        <el-space>
          <el-tag type="info" effect="plain">当前账号：{{ currentUser?.phone ?? '—' }}</el-tag>
          <el-button @click="goHome">回首页</el-button>
        </el-space>
      </template>
    </el-result>
  </el-card>

  <div v-else class="admin-shell">
    <aside class="admin-nav">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ active: isCurrent(item.to) }"
      >
        <strong>{{ item.title }}</strong>
        <span>{{ item.note }}</span>
      </router-link>
    </aside>
    <div class="admin-main">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.deny-card {
  margin-top: 24px;
}

.admin-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}

.admin-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: sticky;
  top: 88px;
}

.nav-item {
  display: block;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: inherit;
  text-decoration: none;
}

.nav-item strong {
  display: block;
  color: var(--forest-deep);
  font-size: 15px;
  line-height: 1.4;
}

.nav-item span {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.nav-item.active {
  border-color: var(--forest);
  background: #fff;
  box-shadow: 0 0 0 1px var(--forest);
}

.nav-item.active strong {
  color: var(--forest);
}

.admin-main {
  min-width: 0;
}

@media (max-width: 860px) {
  .admin-shell {
    grid-template-columns: 1fr;
  }

  .admin-nav {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
