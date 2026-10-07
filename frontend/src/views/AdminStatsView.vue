<script setup lang="ts">
// 管理统计：管理员在网页上直接看使用情况，并点进书架或资料核对。
// 数据仍只来自 GET /api/admin/stats/summary，不改后端字段。
// 权限判定留在视图内：校验中 → 未登录 → 非管理员，三态各自给对应提示。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { EChartsCoreOption } from 'echarts/core'
import { fetchStatsSummary } from '../api/admin'
import { ApiError } from '../api/http'
import type { StatsSummaryResponse } from '../api/types'
import StatsChart from '../components/StatsChart.vue'
import { ADMIN_STATS_REFRESH_MS, TRACK_EVENT_LABELS } from '../constants'
import { authToken, currentUser, isLoggedIn, restoreAuth } from '../composables/useAuth'

const router = useRouter()

// ---------------------------------------------------------------- 权限三态

/** 登录态是否已校验完（false = 还在拉 /me，此刻不能下"非管理员"的结论） */
const authChecked = ref(false)
/** 登录态校验失败但 token 还在（后端 /me 不可用）：这时既不能说他是管理员，也不能说不是 */
const authUnverified = ref(false)

const isAdmin = computed(() => currentUser.value?.isAdmin === true)

/** 是否该展示五块数据区（只有管理员且登录态已确认） */
const showPanel = computed(() => authChecked.value && isAdmin.value && !authUnverified.value)

// ---------------------------------------------------------------- 数据

const summary = ref<StatsSummaryResponse | null>(null)
const loading = ref(false)
const loadError = ref('')

/** 事件分布表的行（key/label 来自 constants，值来自 summary.events，缺项补 0） */
const eventRows = computed(() =>
  TRACK_EVENT_LABELS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: summary.value?.events[entry.key] ?? 0,
  })),
)

const GREEN = '#017c40'
const INK = '#4d4d4d'

const eventChart = computed(() =>
  rankedBar(eventRows.value.map((row) => ({ name: row.label, value: row.count }))),
)
const eventHeight = computed(() => chartHeight(eventRows.value.length))

const askSlices = computed(() => {
  const asks = summary.value?.asks
  if (asks === undefined) return []
  const answered = Math.max(asks.judged - asks.noAnswer, 0)
  return [
    { name: '有答案', value: answered },
    { name: '没有答案', value: asks.noAnswer },
    { name: '还没判定', value: asks.unjudged },
  ]
})

const hasAsks = computed(() => askSlices.value.some((slice) => slice.value > 0))

const askChart = computed<EChartsCoreOption>(() => ({
  color: [GREEN, '#c4a35a', '#8aa4b5'],
  tooltip: { trigger: 'item' },
  legend: { bottom: 0, textStyle: { color: INK } },
  series: [
    {
      type: 'pie',
      radius: ['46%', '70%'],
      center: ['50%', '44%'],
      label: { formatter: '{b}\n{c}' },
      data: askSlices.value.map((slice) => ({
        name: slice.name,
        value: slice.value,
        label: { show: slice.value > 0 },
        labelLine: { show: slice.value > 0 },
      })),
    },
  ],
}))

const searchChart = computed(() =>
  rankedBar(summary.value?.topSearchTerms.map((row) => ({ name: row.term, value: row.count })) ?? []),
)

const downloadChart = computed(() =>
  rankedBar(
    summary.value?.topDownloads.map((row) => ({ name: row.fileName, value: row.count })) ?? [],
  ),
)

const gapChart = computed(() =>
  rankedBar(
    summary.value?.zeroResultSearchTerms.map((row) => ({ name: row.term, value: row.count })) ?? [],
  ),
)

const searchHeight = computed(() => chartHeight(summary.value?.topSearchTerms.length ?? 0))
const downloadHeight = computed(() => chartHeight(summary.value?.topDownloads.length ?? 0))
const gapHeight = computed(() => chartHeight(summary.value?.zeroResultSearchTerms.length ?? 0))

// ---------------------------------------------------------------- 取数

async function loadSummary(): Promise<void> {
  const token = authToken()
  if (token === null || !isAdmin.value) return
  loading.value = true
  loadError.value = ''
  try {
    summary.value = await fetchStatsSummary(token)
  } catch (err) {
    summary.value = null
    loadError.value = err instanceof ApiError ? err.message : '统计摘要加载失败'
  } finally {
    loading.value = false
  }
}

/** 手动刷新按钮（自动刷新之外的第二条路，卡片要求二选一，这里两个都给） */
function onManualRefresh(): void {
  void loadSummary()
}

function goAuth(): void {
  void router.push({ path: '/auth', query: { redirect: '/admin/stats' } })
}

function goHome(): void {
  void router.push('/')
}

function openShelf(term: string): void {
  void router.push({ path: '/shelf', query: { q: term } })
}

function openDownload(fileName: string): void {
  const row = summary.value?.topDownloads.find((item) => item.fileName === fileName)
  if (row === undefined) return
  void router.push(docLink(row.docId))
}

// ---------------------------------------------------------------- 展示辅助

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function docLink(docId: string): string {
  return `/doc/${docId}`
}

function chartHeight(count: number): number {
  return Math.max(220, count * 36)
}

function rankedBar(rows: readonly { readonly name: string; readonly value: number }[]): EChartsCoreOption {
  const ordered = [...rows].reverse()
  return barOption(
    ordered.map((row) => row.name),
    ordered.map((row) => row.value),
    true,
  )
}

function barOption(categories: string[], values: number[], horizontal: boolean): EChartsCoreOption {
  return {
    color: [GREEN],
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    xAxis: horizontal
      ? { type: 'value', min: 0, minInterval: 1, axisLabel: { color: INK } }
      : {
          type: 'category',
          data: categories,
          axisLabel: { color: INK, interval: 0 },
        },
    yAxis: horizontal
      ? {
          type: 'category',
          data: categories,
          axisLabel: { color: INK, width: 160, overflow: 'truncate' },
        }
      : { type: 'value', min: 0, minInterval: 1, axisLabel: { color: INK } },
    series: [
      {
        type: 'bar',
        data: values,
        barMaxWidth: 28,
        itemStyle: { borderRadius: 2 },
      },
    ],
  }
}

// ---------------------------------------------------------------- 启动 / 卸载

/** 自动刷新定时器；组件卸载时必须清掉，否则离开页面还在打接口 */
let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  // 子组件的 onMounted 早于 App.vue 的 restoreAuth，这里显式等一次：
  // 拿到确定的 isAdmin 才决定「显示数据」还是「显示提示页」。
  await restoreAuth()
  authChecked.value = true
  authUnverified.value = isLoggedIn.value && currentUser.value === null
  if (isAdmin.value) {
    await loadSummary()
    timer = setInterval(() => {
      void loadSummary()
    }, ADMIN_STATS_REFRESH_MS)
  }
})

onUnmounted(() => {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <div class="admin-stats">
    <!-- 未登录 / 非管理员 / 校验失败：都是提示页，绝不白屏（卡片验收②） -->
    <el-card v-if="!showPanel" shadow="never" class="deny-card">
      <el-result
        v-if="!authChecked"
        icon="info"
        title="正在校验登录态…"
        sub-title="稍等一下，马上就好"
      />
      <el-result
        v-else-if="!isLoggedIn"
        icon="warning"
        title="需要登录后访问"
        sub-title="管理统计只对登录用户开放，登录后再回来即可。"
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
        sub-title="当前账号不是管理员，看不到统计数据。如需开通，请让运维用 admin:promote 把该账号提为管理员。"
      >
        <template #extra>
          <el-space>
            <el-tag type="info" effect="plain">当前账号：{{ currentUser?.phone ?? '—' }}</el-tag>
            <el-button @click="goHome">回首页</el-button>
          </el-space>
        </template>
      </el-result>
    </el-card>

    <template v-else>
      <el-card shadow="never" class="head-card">
        <div class="head-row">
          <div>
            <h2 class="head-title">管理统计</h2>
            <p class="head-sub">
              更新于 {{ formatTime(summary?.generatedAt ?? '') }}。点检索词去书架核对，点文件名打开资料。每
              5 分钟自动刷新。
            </p>
          </div>
          <el-button :loading="loading" @click="onManualRefresh">刷新</el-button>
        </div>
      </el-card>

      <el-alert
        v-if="loadError !== ''"
        class="load-error"
        type="error"
        show-icon
        :closable="false"
        :title="loadError"
        description="点「刷新」重试，或确认后端 4000 端口在跑。"
      />

      <template v-if="summary !== null">
        <el-row :gutter="16">
          <el-col :xs="12" :sm="6">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.totals.pv }}</div>
              <div class="metric-label">页面浏览</div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="6">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.totals.uv }}</div>
              <div class="metric-label">独立访客</div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="6">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.totals.registeredUsers }}</div>
              <div class="metric-label">注册用户</div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="6">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.asks.total }}</div>
              <div class="metric-label">提问次数</div>
            </el-card>
          </el-col>
        </el-row>

        <el-row :gutter="16" class="block-row">
          <el-col :xs="24" :md="14">
            <el-card shadow="never" class="block">
              <template #header><span class="block-title">站内操作</span></template>
              <StatsChart :option="eventChart" :height="eventHeight" />
            </el-card>
          </el-col>
          <el-col :xs="24" :md="10">
            <el-card shadow="never" class="block">
              <template #header><span class="block-title">提问结果</span></template>
              <StatsChart v-if="hasAsks" :option="askChart" />
              <el-empty v-else description="还没有人提问" />
            </el-card>
          </el-col>
        </el-row>

        <el-row :gutter="16" class="block-row">
          <el-col :xs="24" :md="12">
            <el-card shadow="never" class="block">
              <template #header><span class="block-title">检索热词</span></template>
              <StatsChart
                v-if="summary.topSearchTerms.length > 0"
                :option="searchChart"
                :height="searchHeight"
                @select="openShelf"
              />
              <el-empty v-else description="还没有检索" />
            </el-card>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-card shadow="never" class="block">
              <template #header><span class="block-title">下载最多</span></template>
              <StatsChart
                v-if="summary.topDownloads.length > 0"
                :option="downloadChart"
                :height="downloadHeight"
                @select="openDownload"
              />
              <el-empty v-else description="还没有下载" />
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="never" class="block">
          <template #header><span class="block-title">搜过但没有结果</span></template>
          <StatsChart
            v-if="summary.zeroResultSearchTerms.length > 0"
            :option="gapChart"
            :height="gapHeight"
            @select="openShelf"
          />
          <el-empty v-else description="目前的检索都能找到资料" />
        </el-card>
      </template>
    </template>
  </div>
</template>

<style scoped>
.admin-stats {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.deny-card {
  margin-top: 24px;
}

.head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.head-title {
  margin: 0;
  font-size: 20px;
}

.head-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.load-error {
  margin: 0;
}

.metric-card {
  height: 100%;
}

.block {
  height: 100%;
}

.block-title {
  font-weight: 600;
}

.block-row {
  align-items: stretch;
}

.metric-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.metric-label {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

</style>
