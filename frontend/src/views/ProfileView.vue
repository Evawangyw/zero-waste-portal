<script setup lang="ts">
// 普通用户的个人主页：注册资料、自己的提问、自己的下载。管理员不使用这个页面。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '../api/http'
import { fetchMyProfile } from '../api/auth'
import type { ProfileHomeResponse } from '../api/types'
import { authToken, clearAuth, currentUser, isLoggedIn, restoreAuth } from '../composables/useAuth'

const router = useRouter()
const authChecked = ref(false)
const loading = ref(false)
const loadError = ref('')
const home = ref<ProfileHomeResponse | null>(null)

const isAdmin = computed(() => currentUser.value?.isAdmin === true)
const showHome = computed(
  () => authChecked.value && isLoggedIn.value && currentUser.value !== null && !isAdmin.value,
)

const topicsLabel = computed(() => {
  const topics = home.value?.user.topics ?? []
  return topics.length === 0 ? '未选择' : topics.join('、')
})

onMounted(async () => {
  await restoreAuth()
  authChecked.value = true
  if (!isLoggedIn.value) {
    void router.replace({ path: '/auth', query: { redirect: '/me' } })
    return
  }
  if (currentUser.value === null || isAdmin.value) return
  await loadHome()
})

async function loadHome(): Promise<void> {
  const token = authToken()
  if (token === null) return
  loading.value = true
  loadError.value = ''
  try {
    home.value = await fetchMyProfile(token)
  } catch (err) {
    home.value = null
    if (err instanceof ApiError && err.isUnauthorized) {
      clearAuth()
      void router.replace({ path: '/auth', query: { redirect: '/me' } })
      return
    }
    loadError.value = err instanceof Error ? err.message : '个人主页加载失败'
  } finally {
    loading.value = false
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

function downloadLabel(title: string, fileName: string): string {
  const text = title.trim() !== '' ? title.trim() : fileName.trim()
  return text === '' ? '未命名资料' : text
}

function goAdmin(): void {
  void router.push({ name: 'admin-stats' })
}
</script>

<template>
  <div class="profile">
    <el-card v-if="!showHome" shadow="never">
      <el-result v-if="!authChecked" icon="info" title="正在打开个人主页…" sub-title="稍等一下，马上就好" />
      <el-result
        v-else-if="isLoggedIn && currentUser === null"
        icon="error"
        title="暂时无法确认账号"
        sub-title="登录状态还没有取回来，刷新页面再试一次。"
      />
      <el-result
        v-else-if="isAdmin"
        icon="info"
        title="管理员请使用管理统计"
        sub-title="个人主页只给普通用户看自己的提问和下载。全站记录在管理统计里。"
      >
        <template #extra>
          <el-button type="primary" @click="goAdmin">去管理统计</el-button>
        </template>
      </el-result>
    </el-card>

    <template v-else>
      <header class="hero">
        <p class="eyebrow">个人主页</p>
        <h1>{{ home?.user.name ?? currentUser?.name }}</h1>
        <p class="lead">这里只显示你自己的提问和下载。</p>
      </header>

      <el-card v-if="loading" shadow="never">正在读取记录…</el-card>
      <el-card v-else-if="loadError !== ''" shadow="never">
        <p class="error">{{ loadError }}</p>
        <el-button type="primary" @click="loadHome">再试一次</el-button>
      </el-card>

      <template v-else-if="home !== null">
        <section class="facts">
          <p><span>机构</span>{{ home.user.org.trim() === '' ? '未填写' : home.user.org }}</p>
          <p><span>岗位</span>{{ home.user.occupation.trim() === '' ? '未填写' : home.user.occupation }}</p>
          <p><span>关注议题</span>{{ topicsLabel }}</p>
          <p><span>手机</span>{{ home.user.phone }}</p>
          <p><span>注册时间</span>{{ formatTime(home.user.createdAt) }}</p>
        </section>

        <section class="block">
          <div class="block-head">
            <h2>历史提问</h2>
            <p v-if="home.questionTotal === 0">还没有提问</p>
            <p v-else-if="home.questionTotal > home.questions.length">
              共 {{ home.questionTotal }} 次，这里显示最近 {{ home.questions.length }} 次
            </p>
            <p v-else>共 {{ home.questionTotal }} 次</p>
          </div>
          <article v-for="item in home.questions" :key="item.id" class="record">
            <time>{{ formatTime(item.createdAt) }}</time>
            <h3>{{ item.question }}</h3>
            <p v-if="item.answer.trim() === ''" class="muted">这次没有留下回答</p>
            <p v-else class="answer">{{ item.answer }}</p>
          </article>
          <router-link class="more" to="/ask">去 AI 助手继续提问</router-link>
        </section>

        <section class="block">
          <div class="block-head">
            <h2>下载记录</h2>
            <p v-if="home.downloadTotal === 0">还没有下载</p>
            <p v-else-if="home.downloadTotal > home.downloads.length">
              共 {{ home.downloadTotal }} 次，这里显示最近 {{ home.downloads.length }} 次
            </p>
            <p v-else>共 {{ home.downloadTotal }} 次</p>
          </div>
          <article v-for="item in home.downloads" :key="item.id" class="record">
            <time>{{ formatTime(item.createdAt) }}</time>
            <h3>
              <router-link :to="`/doc/${item.docId}`">
                {{ downloadLabel(item.docTitle, item.fileName) }}
              </router-link>
            </h3>
            <p v-if="item.fileName.trim() !== ''" class="muted">{{ item.fileName }}</p>
          </article>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.profile {
  display: flex;
  flex-direction: column;
  gap: 22px;
  max-width: 760px;
}

.hero {
  padding-top: 8px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--rust);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

h1 {
  margin: 0 0 8px;
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 34px;
  line-height: 1.25;
}

h2 {
  margin: 0;
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 24px;
}

.lead,
.block-head p,
.muted {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}

.facts {
  display: grid;
  gap: 10px;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
}

.facts p {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  margin: 0;
  line-height: 1.6;
}

.facts span {
  color: var(--muted);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.record {
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
}

.record time {
  color: var(--muted);
  font-size: 12px;
}

.record h3 {
  margin: 6px 0 8px;
  color: var(--ink);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.5;
}

.record a {
  color: var(--forest-deep);
  text-decoration: none;
}

.record a:hover {
  text-decoration: underline;
}

.answer {
  margin: 0;
  color: var(--ink);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.more {
  align-self: flex-start;
  color: var(--forest);
  font-weight: 700;
  text-decoration: none;
}

.error {
  margin: 0 0 12px;
}

@media (max-width: 640px) {
  h1 {
    font-size: 28px;
  }

  .block-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .facts p {
    grid-template-columns: 72px minmax(0, 1fr);
  }
}
</style>
