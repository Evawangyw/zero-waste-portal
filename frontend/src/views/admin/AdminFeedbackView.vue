<script setup lang="ts">
// 问题反馈：用户从右下角提交的分类和描述。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchFeedbackList, updateFeedbackStatus } from '../../api/feedback'
import type { FeedbackItem } from '../../api/feedback'
import { ApiError } from '../../api/http'
import { authToken } from '../../composables/useAuth'

type StatusFilter = 'open' | 'done' | 'all'

const items = ref<FeedbackItem[]>([])
const total = ref(0)
const openCount = ref(0)
const filter = ref<StatusFilter>('open')
const loading = ref(true)
const ready = ref(false)
const error = ref('')
const savingId = ref('')

const tableRows = computed(() => [...items.value])

onMounted(() => {
  void load()
})

async function load(): Promise<void> {
  const token = authToken()
  if (token === null) return
  loading.value = true
  error.value = ''
  try {
    const list = await fetchFeedbackList(token, filter.value)
    items.value = [...list.items]
    total.value = list.total
    openCount.value = list.open
  } catch (err) {
    items.value = []
    error.value = err instanceof ApiError ? err.message : '问题反馈加载失败'
  } finally {
    loading.value = false
    ready.value = true
  }
}

function setFilter(next: StatusFilter): void {
  if (filter.value === next) return
  filter.value = next
  void load()
}

async function mark(row: FeedbackItem, status: 'open' | 'done'): Promise<void> {
  const token = authToken()
  if (token === null || savingId.value !== '') return
  savingId.value = row.id
  try {
    await updateFeedbackStatus(token, row.id, status)
    ElMessage.success(status === 'done' ? '已标为已处理' : '已标为未处理')
    await load()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '更新失败')
  } finally {
    savingId.value = ''
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function emptyText(): string {
  if (filter.value === 'open') return '没有未处理的反馈'
  if (filter.value === 'done') return '没有已处理的反馈'
  return '还没有问题反馈'
}
</script>

<template>
  <div class="feedback-page">
    <header class="head">
      <div>
        <h2>问题反馈</h2>
        <p v-if="ready">未处理 {{ openCount }} 条，共 {{ total }} 条。登录用户会带上姓名和手机号，未登录显示为访客。</p>
        <p v-else>正在读取反馈…</p>
      </div>
    </header>

    <div class="tools">
      <el-button :type="filter === 'open' ? 'primary' : 'default'" @click="setFilter('open')">未处理</el-button>
      <el-button :type="filter === 'done' ? 'primary' : 'default'" @click="setFilter('done')">已处理</el-button>
      <el-button :type="filter === 'all' ? 'primary' : 'default'" @click="setFilter('all')">全部</el-button>
    </div>

    <el-alert v-if="error !== ''" type="error" :closable="false" :title="error" />

    <el-table v-loading="loading" :data="tableRows" row-key="id" size="small" :empty-text="emptyText()">
      <el-table-column label="时间" min-width="168">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="categoryLabel" label="分类" min-width="140" />
      <el-table-column label="具体问题" min-width="260">
        <template #default="{ row }">
          <div class="desc">{{ row.description }}</div>
          <div v-if="row.pagePath !== ''" class="sub">页面 {{ row.pagePath }}</div>
        </template>
      </el-table-column>
      <el-table-column label="提交人" min-width="160">
        <template #default="{ row }">
          <template v-if="row.user">
            <div>{{ row.user.name }}</div>
            <div class="sub">{{ row.user.phone }}<span v-if="row.user.org !== ''"> · {{ row.user.org }}</span></div>
          </template>
          <span v-else>未登录访客</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="96">
        <template #default="{ row }">
          <el-tag :type="row.status === 'open' ? 'warning' : 'success'" effect="plain">
            {{ row.status === 'open' ? '未处理' : '已处理' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'open'"
            link
            type="primary"
            :loading="savingId === row.id"
            @click="mark(row, 'done')"
          >
            标为已处理
          </el-button>
          <el-button v-else link :loading="savingId === row.id" @click="mark(row, 'open')">标为未处理</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.feedback-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

h2 {
  margin: 0 0 6px;
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 26px;
}

.head p {
  margin: 0;
  color: var(--muted);
  line-height: 1.6;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.desc {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}

.sub {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
  word-break: break-all;
}
</style>
