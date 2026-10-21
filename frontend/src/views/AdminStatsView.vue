<script setup lang="ts">
// 管理统计：管理员在网页上直接看使用情况，并点进书架或资料核对。
// 数据来自 GET /api/admin/stats/summary。提问结果用回写后的判定，高频提问用 topAskTerms。
// 权限判定留在视图内：校验中 → 未登录 → 非管理员，三态各自给对应提示。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { EChartsCoreOption } from 'echarts/core'
import { fetchAdminShelf, fetchStatsSummary, setAdminDocListed, uploadAdminDocument } from '../api/admin'
import { ApiError } from '../api/http'
import type { AdminShelfItem, StatsSummaryResponse } from '../api/types'
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
const fileInput = ref<HTMLInputElement | null>(null)
const uploadOpen = ref(false)
const uploadFile = ref<File | null>(null)
const uploadBusy = ref(false)
const uploadError = ref('')
const uploadTitle = ref('')
const uploadYear = ref('')
const uploadOrg = ref('')
const uploadType = ref('')
const uploadTopic = ref('')
const uploadLibrary = ref('')

/** 事件分布表的行（key/label 来自 constants，值来自 summary.events，缺项补 0） */
const eventRows = computed(() =>
  TRACK_EVENT_LABELS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: summary.value?.events[entry.key] ?? 0,
  })),
)

const GREEN = '#285c49'
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

const askTermChart = computed(() =>
  rankedBar(
    summary.value?.topAskTerms.map((row) => ({ name: row.term, value: row.count })) ?? [],
    280,
  ),
)

const searchChart = computed(() => searchHeatmap(summary.value?.topSearchTerms ?? []))

const downloadChart = computed(() =>
  rankedBar(
    summary.value?.topDownloads.map((row) => ({
      name: downloadTitle(row.fileName),
      value: row.count,
    })) ?? [],
    168,
    'break',
  ),
)

const askTermHeight = computed(() => chartHeight(summary.value?.topAskTerms.length ?? 0))
const searchHeight = computed(() => heatmapHeight(summary.value?.topSearchTerms.length ?? 0))
const downloadHeight = computed(() => Math.max(120, (summary.value?.topDownloads.length ?? 0) * 56))
const askCountLine = computed(() => {
  const [answered, missed, pending] = askSlices.value
  if (answered === undefined || missed === undefined || pending === undefined) return ''
  return `有答案 ${answered.value}，没有答案 ${missed.value}，还没判定 ${pending.value}`
})
const askTermRows = computed(() =>
  (summary.value?.topAskTerms ?? []).map((row) => ({ term: row.term, count: row.count })),
)
const downloadRows = computed(() =>
  (summary.value?.topDownloads ?? []).map((row) => ({
    docId: row.docId,
    title: downloadTitle(row.fileName),
    count: row.count,
  })),
)
const registrationRows = computed(() => [...(summary.value?.profiles.users ?? [])])

const occupationRows = computed(() => summary.value?.profiles.byOccupation ?? [])
const topicRows = computed(() => summary.value?.profiles.byTopic ?? [])
const orgRows = computed(() => summary.value?.profiles.byOrg ?? [])
const occupationChart = computed(() =>
  rankedBar(occupationRows.value.map((row) => ({ name: row.label, value: row.count })), 140),
)
const topicChart = computed(() =>
  rankedBar(topicRows.value.map((row) => ({ name: row.label, value: row.count })), 140),
)
const orgChart = computed(() =>
  rankedBar(orgRows.value.map((row) => ({ name: row.label, value: row.count })), 160),
)

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
  void loadListing()
}

function openUploadPicker(): void {
  uploadError.value = ''
  fileInput.value?.click()
}

function onUploadPicked(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return
  const file = input.files?.[0] ?? null
  input.value = ''
  if (file === null) return
  uploadFile.value = file
  uploadTitle.value = file.name.replace(/\.[a-z0-9]{1,8}$/iu, '')
  uploadYear.value = ''
  uploadOrg.value = ''
  uploadType.value = ''
  uploadTopic.value = ''
  uploadLibrary.value = ''
  uploadError.value = ''
  uploadOpen.value = true
}

function closeUpload(): void {
  if (uploadBusy.value) return
  uploadOpen.value = false
  uploadFile.value = null
}

async function submitUpload(): Promise<void> {
  const token = authToken()
  const file = uploadFile.value
  if (token === null || file === null || uploadBusy.value) return
  uploadBusy.value = true
  uploadError.value = ''
  try {
    const result = await uploadAdminDocument(token, file, {
      title: uploadTitle.value.trim(),
      year: uploadYear.value.trim(),
      org: uploadOrg.value.trim(),
      docType: uploadType.value.trim(),
      topic: uploadTopic.value.trim(),
      library: uploadLibrary.value,
    })
    uploadOpen.value = false
    uploadFile.value = null
    ElMessage.success(`《${result.doc.title}》已上架。${result.somark.message}`)
    await loadSummary()
    await loadListing()
  } catch (err) {
    uploadError.value = err instanceof ApiError ? err.message : '上传失败'
  } finally {
    uploadBusy.value = false
  }
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

function openDownload(label: string): void {
  const row = summary.value?.topDownloads.find(
    (item) => item.fileName === label || downloadTitle(item.fileName) === label,
  )
  if (row === undefined) return
  void router.push(docLink(row.docId))
}

/** 下载文件名是「年份-机构-标题.ext」。图上只留标题，避免年份和机构把柱子挤没。 */
function downloadTitle(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{1,8}$/iu, '')
  const parts = base.split('-')
  const year = parts[0] ?? ''
  if (parts.length >= 3 && /^\d{4}$/u.test(year)) return parts.slice(2).join('-')
  return base === '' ? fileName : base
}

// ---------------------------------------------------------------- 展示辅助

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function formatOptionalTime(value: string | null): string {
  if (value === null || value === '') return '—'
  return formatTime(value)
}

function visitorStamp(row: unknown, key: 'firstSeenAt' | 'lastSeenAt'): string {
  if (typeof row !== 'object' || row === null || !(key in row)) return ''
  const value = Reflect.get(row, key)
  return typeof value === 'string' ? value : ''
}

function docLink(docId: string): string {
  return `/doc/${docId}`
}

function profileText(value: string, empty: string): string {
  const text = value.trim()
  return text === '' ? empty : text
}

function topicText(topics: readonly string[]): string {
  return topics.length === 0 ? '未选择' : topics.join('、')
}

function chartHeight(count: number): number {
  return Math.max(220, count * 36)
}

/** 热词按网格铺开，一行最多 5 个，高度跟着行数走。 */
function heatmapHeight(count: number): number {
  if (count <= 0) return 220
  const cols = Math.min(5, count)
  const rows = Math.ceil(count / cols)
  return rows * 76 + 16
}

function searchHeatmap(
  rows: readonly { readonly term: string; readonly count: number }[],
): EChartsCoreOption {
  const cols = Math.min(5, Math.max(rows.length, 1))
  const rowCount = Math.max(1, Math.ceil(rows.length / cols))
  const max = rows.reduce((highest, row) => Math.max(highest, row.count), 1)
  return {
    tooltip: {
      formatter(raw: unknown): string {
        const name = readHeatName(raw)
        const count = readHeatCount(raw)
        return name === '' ? '' : `${name}<br/>检索 ${count} 次`
      },
    },
    grid: { left: 8, right: 64, top: 8, bottom: 8 },
    xAxis: {
      type: 'category',
      data: axisLabels(cols),
      show: false,
    },
    yAxis: {
      type: 'category',
      data: axisLabels(rowCount),
      inverse: true,
      show: false,
    },
    visualMap: {
      min: 0,
      max,
      calculable: false,
      orient: 'vertical',
      right: 0,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 72,
      text: ['高', '低'],
      textStyle: { color: INK, fontSize: 12 },
      inRange: { color: ['#efe6d4', '#285c49'] },
    },
    series: [
      {
        type: 'heatmap',
        data: rows.map((row, index) => ({
          value: [index % cols, Math.floor(index / cols), row.count],
          name: row.term,
        })),
        label: {
          show: true,
          formatter(raw: unknown): string {
            const name = readHeatName(raw)
            const count = readHeatCount(raw)
            const short = name.length > 6 ? `${name.slice(0, 6)}…` : name
            const tone = count / max >= 0.55 ? 'onDark' : 'onLight'
            return `{${tone}|${short}\n${count}}`
          },
          rich: {
            onDark: { color: '#ffffff', fontSize: 12, align: 'center', lineHeight: 18 },
            onLight: { color: '#123524', fontSize: 12, align: 'center', lineHeight: 18 },
          },
        },
        itemStyle: { borderColor: '#ffffff', borderWidth: 6 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(1, 124, 64, 0.25)' } },
      },
    ],
  }
}

function axisLabels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(index))
}

/** 轴上只留短标题。全文放在提示和下面的表里，避免长句子把柱子挤出画布。 */
function shortAxisLabel(text: string, labelWidth: number): string {
  const max = Math.max(8, Math.floor(labelWidth / 14))
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function readBarTip(
  raw: unknown,
  categories: readonly string[],
): { readonly name: string; readonly value: number } {
  const item = Array.isArray(raw) ? raw[0] : raw
  if (typeof item !== 'object' || item === null) return { name: '', value: 0 }
  const dataIndex = 'dataIndex' in item && typeof item.dataIndex === 'number' ? item.dataIndex : -1
  const named = 'name' in item && typeof item.name === 'string' ? item.name : ''
  const fromIndex = dataIndex >= 0 ? categories[dataIndex] : undefined
  const value = 'value' in item && typeof item.value === 'number' ? item.value : 0
  return { name: fromIndex ?? named, value }
}

function readHeatName(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || !('name' in raw)) return ''
  return typeof raw.name === 'string' ? raw.name : ''
}

function readHeatCount(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null || !('value' in raw)) return 0
  const value = raw.value
  if (!Array.isArray(value)) return 0
  const count = value[2]
  return typeof count === 'number' ? count : 0
}

function rankedBar(
  rows: readonly { readonly name: string; readonly value: number }[],
  labelWidth = 160,
  overflow: 'truncate' | 'break' = 'truncate',
): EChartsCoreOption {
  const ordered = [...rows].reverse()
  return barOption(
    ordered.map((row) => row.name),
    ordered.map((row) => row.value),
    true,
    labelWidth,
    overflow,
  )
}

function barOption(
  categories: string[],
  values: number[],
  horizontal: boolean,
  labelWidth = 160,
  overflow: 'truncate' | 'break' = 'truncate',
): EChartsCoreOption {
  const axisNames = categories.map((name) => shortAxisLabel(name, labelWidth))
  return {
    color: [GREEN],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter(raw: unknown): string {
        const tip = readBarTip(raw, categories)
        return tip.name === '' ? '' : `${tip.name}<br/>${tip.value} 次`
      },
    },
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    xAxis: horizontal
      ? { type: 'value', min: 0, minInterval: 1, axisLabel: { color: INK } }
      : {
          type: 'category',
          data: axisNames,
          axisLabel: { color: INK, interval: 0 },
        },
    yAxis: horizontal
      ? {
          type: 'category',
          data: axisNames,
          axisLabel: { color: INK, width: labelWidth, overflow, lineHeight: 16 },
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

// ---------------------------------------------------------------- 上下架

const LISTING_PAGE_SIZE = 10

const listingItems = ref<AdminShelfItem[]>([])
const listingTotal = ref(0)
const listingPage = ref(1)
const listingQuery = ref('')
const listingFilter = ref<'1' | '0' | 'all'>('1')
const listingLoading = ref(false)
const listingError = ref('')
const listingBusyId = ref('')
let listingTimer: ReturnType<typeof setTimeout> | undefined

function onListingInput(): void {
  if (listingTimer !== undefined) clearTimeout(listingTimer)
  listingTimer = setTimeout(() => {
    listingTimer = undefined
    listingPage.value = 1
    void loadListing()
  }, 300)
}

function setListingFilter(next: '1' | '0' | 'all'): void {
  listingFilter.value = next
  listingPage.value = 1
  void loadListing()
}

function onListingPage(next: number): void {
  listingPage.value = next
  void loadListing()
}

async function loadListing(): Promise<void> {
  const token = authToken()
  if (token === null || !isAdmin.value) return
  listingLoading.value = true
  listingError.value = ''
  try {
    const page = await fetchAdminShelf(token, {
      q: listingQuery.value.trim(),
      listed: listingFilter.value,
      page: listingPage.value,
    })
    listingItems.value = [...page.items]
    listingTotal.value = page.total
    listingPage.value = page.page
  } catch (err) {
    listingError.value = err instanceof ApiError ? err.message : '资料列表加载失败'
  } finally {
    listingLoading.value = false
  }
}

async function toggleListed(row: AdminShelfItem): Promise<void> {
  const token = authToken()
  if (token === null || listingBusyId.value !== '') return
  listingBusyId.value = row.id
  const nextListed = !row.listed
  try {
    await setAdminDocListed(token, row.id, nextListed)
    ElMessage.success(nextListed ? `《${row.title}》已上架` : `《${row.title}》已下架`)
    if (summary.value !== null) {
      const delta = nextListed ? 1 : -1
      summary.value = {
        ...summary.value,
        library: { ...summary.value.library, documents: summary.value.library.documents + delta },
      }
    }
    await loadListing()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    listingBusyId.value = ''
  }
}

function listingMeta(row: AdminShelfItem): string {
  const parts = [row.year, row.org, row.docType].filter((part) => part.trim() !== '')
  return parts.length === 0 ? '未标注' : parts.join(' · ')
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
    await loadListing()
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
  if (listingTimer !== undefined) clearTimeout(listingTimer)
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
          <div class="head-actions">
            <el-button type="primary" @click="openUploadPicker">上传资料</el-button>
            <el-button :loading="loading" @click="onManualRefresh">刷新</el-button>
          </div>
        </div>
      </el-card>

      <input
        ref="fileInput"
        class="upload-input"
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf"
        @change="onUploadPicked"
      />

      <el-dialog v-model="uploadOpen" title="上传资料" width="min(480px, calc(100vw - 24px))" :close-on-click-modal="!uploadBusy" :show-close="!uploadBusy" @close="closeUpload">
        <p class="upload-file">{{ uploadFile?.name }}</p>
        <p class="metric-note">上传后用 SoMark 转成 Markdown，写入书架和问答。页数多时会多等一会儿。</p>
        <el-form label-position="top">
          <el-form-item label="标题">
            <el-input v-model="uploadTitle" maxlength="200" />
          </el-form-item>
          <el-form-item label="年份">
            <el-input v-model="uploadYear" maxlength="4" placeholder="例如 2024，可空" />
          </el-form-item>
          <el-form-item label="发布机构">
            <el-input v-model="uploadOrg" maxlength="80" />
          </el-form-item>
          <el-form-item label="知识类型">
            <el-input v-model="uploadType" maxlength="40" placeholder="例如 研究报告" />
          </el-form-item>
          <el-form-item label="知识领域">
            <el-select v-model="uploadLibrary" clearable placeholder="零废弃或化学品" style="width: 100%">
              <el-option label="零废弃" value="零废弃" />
              <el-option label="化学品" value="化学品" />
            </el-select>
          </el-form-item>
          <el-form-item label="细分">
            <el-input v-model="uploadTopic" maxlength="40" placeholder="例如 塑料、国际公约" />
          </el-form-item>
        </el-form>
        <el-alert v-if="uploadError !== ''" type="error" :closable="false" :title="uploadError" />
        <template #footer>
          <el-button :disabled="uploadBusy" @click="closeUpload">取消</el-button>
          <el-button type="primary" :loading="uploadBusy" @click="submitUpload">
            {{ uploadBusy ? '正在转换并入库' : '开始上传' }}
          </el-button>
        </template>
      </el-dialog>

      <el-card shadow="never" class="block">
        <template #header><span class="block-title">资料上下架</span></template>
        <p class="metric-note visit-note">
          下架后，公众书架不再显示，也不能打开或下载。首页提问不会再引用它。文件还在，可以再上架。
        </p>
        <div class="listing-tools">
          <el-input
            v-model="listingQuery"
            clearable
            placeholder="搜标题、文件名或机构"
            class="listing-search"
            @input="onListingInput"
          />
          <el-button :type="listingFilter === '1' ? 'primary' : 'default'" @click="setListingFilter('1')">
            已上架
          </el-button>
          <el-button :type="listingFilter === '0' ? 'primary' : 'default'" @click="setListingFilter('0')">
            已下架
          </el-button>
          <el-button :type="listingFilter === 'all' ? 'primary' : 'default'" @click="setListingFilter('all')">
            全部
          </el-button>
        </div>
        <el-alert v-if="listingError !== ''" type="error" :closable="false" :title="listingError" />
        <el-table v-loading="listingLoading" :data="listingItems" size="small" empty-text="没有符合的资料">
          <el-table-column label="资料" min-width="240">
            <template #default="{ row }">
              <div class="listing-title">{{ row.title }}</div>
              <div class="metric-note">{{ listingMeta(row) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">{{ row.listed ? '已上架' : '已下架' }}</template>
          </el-table-column>
          <el-table-column label="" width="100">
            <template #default="{ row }">
              <el-button
                size="small"
                :type="row.listed ? 'warning' : 'primary'"
                :loading="listingBusyId === row.id"
                @click="toggleListed(row)"
              >
                {{ row.listed ? '下架' : '上架' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="listingTotal > LISTING_PAGE_SIZE" class="listing-pager">
          <el-pagination
            layout="prev, pager, next, total"
            :current-page="listingPage"
            :page-size="LISTING_PAGE_SIZE"
            :total="listingTotal"
            @current-change="onListingPage"
          />
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
          <el-col :xs="12" :sm="8" :lg="4">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.library.documents }}</div>
              <div class="metric-label">知识库文档</div>
              <div class="metric-note">已上架，可检索</div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="8" :lg="4">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.library.regularUsers }}</div>
              <div class="metric-label">普通用户</div>
              <div class="metric-note">管理员 {{ summary.library.adminUsers }}</div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="8" :lg="4">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.library.downloads }}</div>
              <div class="metric-label">累计下载</div>
              <div class="metric-note">资料下载次数</div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="8" :lg="4">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.library.questions }}</div>
              <div class="metric-label">AI 提问</div>
              <div class="metric-note">已写入对话的提问</div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="8" :lg="4">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.library.visitors }}</div>
              <div class="metric-label">独立访客</div>
              <div class="metric-note">今日活跃 {{ summary.library.activeToday }}</div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="8" :lg="4">
            <el-card shadow="never" class="metric-card">
              <div class="metric-value">{{ summary.library.pendingSubmissions }}</div>
              <div class="metric-label">待审核资料</div>
              <div class="metric-note">反馈提交 {{ summary.library.feedbackEvents }} 次</div>
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="never" class="block">
          <template #header><span class="block-title">用户构成</span></template>
          <p class="metric-note visit-note">
            按注册资料汇总，共 {{ summary.profiles.total }} 人。岗位是在所属机构担任的职务，领域取关注议题。一人可以选多个议题，领域各组人数加起来可以大于注册人数。
          </p>
          <el-empty v-if="summary.profiles.total === 0" description="还没有注册用户" />
          <template v-else>
            <el-row :gutter="16">
              <el-col :xs="24" :md="8">
                <h3 class="sub-title">岗位</h3>
                <StatsChart :option="occupationChart" :height="chartHeight(occupationRows.length)" />
              </el-col>
              <el-col :xs="24" :md="8">
                <h3 class="sub-title">领域</h3>
                <StatsChart :option="topicChart" :height="chartHeight(topicRows.length)" />
              </el-col>
              <el-col :xs="24" :md="8">
                <h3 class="sub-title">所属机构</h3>
                <StatsChart :option="orgChart" :height="chartHeight(orgRows.length)" />
              </el-col>
            </el-row>
            <h3 class="sub-title user-table-title">注册用户</h3>
            <p class="metric-note visit-note">展开一行查看岗位、领域和机构。领域是注册时选的关注议题。手机号只在这个管理页显示。</p>
            <el-table :data="registrationRows" row-key="id" size="small" empty-text="还没有注册用户">
              <el-table-column type="expand">
                <template #default="{ row }">
                  <div class="reg-expand">
                    <div><span>岗位</span><b>{{ profileText(row.occupation, '未填写') }}</b></div>
                    <div><span>领域</span><b>{{ topicText(row.topics) }}</b></div>
                    <div><span>机构</span><b>{{ profileText(row.org, '未填写') }}</b></div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="姓名" min-width="120" />
              <el-table-column prop="phone" label="手机号" min-width="140" />
              <el-table-column label="注册时间" min-width="170">
                <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
              </el-table-column>
            </el-table>
          </template>
        </el-card>

        <el-card shadow="never" class="block">
          <template #header><span class="block-title">知识库索引</span></template>
          <div v-if="summary.library.index.available" class="kv-grid">
            <div><span>已审核文档</span><b>{{ summary.library.index.documentsApproved }} / {{ summary.library.index.documentsTotal }}</b></div>
            <div><span>已索引文档</span><b>{{ summary.library.index.indexedDocuments }}</b></div>
            <div><span>正文切片</span><b>{{ summary.library.index.chunks }}</b></div>
            <div><span>平均切片/篇</span><b>{{ summary.library.index.avgChunksPerDoc }}</b></div>
            <div><span>最近向量索引</span><b>{{ formatOptionalTime(summary.library.index.lastVectorAt) }}</b></div>
            <div><span>书架同步时间</span><b>{{ formatOptionalTime(summary.library.index.shelfSyncedAt) }}</b></div>
          </div>
          <el-empty v-else description="语料库这次没有读到，切片数字先空着" />
          <p v-if="summary.library.index.docsWithoutChunks.count > 0" class="index-warn">
            有 {{ summary.library.index.docsWithoutChunks.count }} 份已审核文档没有切片：{{ summary.library.index.docsWithoutChunks.samples.join('、') }}
          </p>
        </el-card>

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
              <template v-if="hasAsks">
                <p class="metric-note visit-note">{{ askCountLine }}。按已回写的回答判定，没有回答正文的记为还没判定。</p>
                <StatsChart :option="askChart" />
              </template>
              <el-empty v-else description="还没有人提问" />
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="never" class="block">
          <template #header><span class="block-title">高频提问</span></template>
          <template v-if="askTermRows.length > 0">
            <el-table :data="askTermRows" size="small" empty-text="还没有提问">
              <el-table-column prop="term" label="提问" min-width="240" />
              <el-table-column prop="count" label="次数" width="80" />
            </el-table>
            <StatsChart :option="askTermChart" :height="askTermHeight" />
          </template>
          <el-empty v-else description="还没有提问" />
        </el-card>

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
              <template v-if="downloadRows.length > 0">
                <el-table :data="downloadRows" size="small" empty-text="还没有下载">
                  <el-table-column label="资料" min-width="180">
                    <template #default="{ row }">
                      <el-button link type="primary" @click="openDownload(row.title)">{{ row.title }}</el-button>
                    </template>
                  </el-table-column>
                  <el-table-column prop="count" label="次数" width="80" />
                </el-table>
                <StatsChart :option="downloadChart" :height="downloadHeight" @select="openDownload" />
              </template>
              <el-empty v-else description="还没有下载" />
            </el-card>
          </el-col>
        </el-row>

        <el-card shadow="never" class="block">
          <template #header>
            <span class="block-title">访问概览</span>
          </template>
          <div class="kv-grid">
            <div><span>独立访客</span><b>{{ summary.library.visitors }}</b></div>
            <div><span>今日活跃</span><b>{{ summary.library.activeToday }}</b></div>
            <div><span>累计访问</span><b>{{ summary.library.visitHits }}</b></div>
          </div>
          <p class="metric-note visit-note">按登录账号或匿名会话统计。当前版本不记录 IP。</p>
          <el-table v-if="summary.library.recentVisitors.length > 0" :data="summary.library.recentVisitors" size="small">
            <el-table-column prop="label" label="访客" min-width="140" />
            <el-table-column prop="hits" label="行为次数" width="100" />
            <el-table-column label="首次" min-width="160">
              <template #default="{ row }">{{ formatTime(visitorStamp(row, 'firstSeenAt')) }}</template>
            </el-table-column>
            <el-table-column label="最近" min-width="160">
              <template #default="{ row }">{{ formatTime(visitorStamp(row, 'lastSeenAt')) }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="还没有访问记录" />
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

.head-actions {
  display: flex;
  flex: none;
  gap: 8px;
}

.upload-input {
  display: none;
}

.listing-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}

.listing-search {
  width: 280px;
  max-width: 100%;
}

.listing-title {
  line-height: 1.4;
}

.listing-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.upload-file {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}

.head-title {
  margin: 0;
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 36px;
  font-weight: 700;
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

.sub-title {
  margin: 0 0 4px;
  color: #1c3328;
  font-size: 14px;
  font-weight: 600;
}

.block-row {
  align-items: stretch;
}

.metric-value {
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 32px;
  font-weight: 700;
  line-height: 1.15;
}

.metric-label {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.metric-note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.kv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px 16px;
}

.kv-grid span {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.kv-grid b {
  font-size: 16px;
  font-weight: 650;
}

.index-warn {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--el-color-warning);
}

.visit-note {
  margin: 8px 0 12px;
}

.user-table-title {
  margin-top: 8px;
}

.reg-expand {
  display: grid;
  gap: 8px;
  padding: 4px 8px 8px 48px;
}

.reg-expand div {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 12px;
  font-size: 14px;
}

.reg-expand span {
  color: var(--el-text-color-secondary);
}

</style>
