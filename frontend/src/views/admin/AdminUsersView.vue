<script setup lang="ts">
// 注册信息：每个注册用户一行，可导出。手机号只出现在这个管理页。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchStatsSummary } from '../../api/admin'
import { ApiError } from '../../api/http'
import type { AdminRegistrationRow } from '../../api/types'
import { authToken } from '../../composables/useAuth'
import { downloadCsv } from '../../utils/export-csv'

const rows = ref<AdminRegistrationRow[]>([])
const loading = ref(false)
const error = ref('')

const tableRows = computed(() => [...rows.value])

onMounted(() => {
  void load()
})

async function load(): Promise<void> {
  const token = authToken()
  if (token === null) return
  loading.value = true
  error.value = ''
  try {
    const summary = await fetchStatsSummary(token)
    rows.value = [...summary.profiles.users]
  } catch (err) {
    rows.value = []
    error.value = err instanceof ApiError ? err.message : '注册信息加载失败'
  } finally {
    loading.value = false
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function topicText(topics: readonly string[]): string {
  return topics.length === 0 ? '未选择' : topics.join('、')
}

function filled(value: string): string {
  const text = value.trim()
  return text === '' ? '未填写' : text
}

function exportTable(): void {
  downloadCsv(
    '注册信息.csv',
    ['姓名', '手机号', '岗位', '机构', '关注议题', '身份', '注册时间'],
    rows.value.map((row) => [
      row.name,
      row.phone,
      filled(row.occupation),
      filled(row.org),
      topicText(row.topics),
      row.isAdmin ? '管理员' : '普通用户',
      formatTime(row.createdAt),
    ]),
  )
  ElMessage.success(`已导出 ${rows.value.length} 人`)
}
</script>

<template>
  <div class="users-page">
    <header class="head">
      <div>
        <h2>注册信息</h2>
        <p>共 {{ rows.length }} 人。手机号只在这个管理页显示，导出的表格也带手机号。</p>
      </div>
      <el-button :disabled="rows.length === 0" @click="exportTable">导出表格</el-button>
    </header>

    <el-alert v-if="error !== ''" type="error" :closable="false" :title="error" />

    <el-table v-loading="loading" :data="tableRows" row-key="id" size="small" empty-text="还没有注册用户">
      <el-table-column prop="name" label="姓名" min-width="110" />
      <el-table-column prop="phone" label="手机号" min-width="130" />
      <el-table-column label="岗位" min-width="120">
        <template #default="{ row }">{{ filled(row.occupation) }}</template>
      </el-table-column>
      <el-table-column label="机构" min-width="140">
        <template #default="{ row }">{{ filled(row.org) }}</template>
      </el-table-column>
      <el-table-column label="关注议题" min-width="160">
        <template #default="{ row }">{{ topicText(row.topics) }}</template>
      </el-table-column>
      <el-table-column label="身份" width="100">
        <template #default="{ row }">{{ row.isAdmin ? '管理员' : '普通用户' }}</template>
      </el-table-column>
      <el-table-column label="注册时间" min-width="170">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.users-page {
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

@media (max-width: 640px) {
  .head {
    flex-direction: column;
  }
}
</style>
