<script setup lang="ts">
// 资料书架页（T05）：接 T03 的 /api/docs 与 /api/docs/facets。
// 筛选（年份/机构/类型/主题，多选） + 排序 + 分页 + 文件名搜索。
// 零结果时**常驻**「试试问 AI」，点一下把搜索词预填进挂件（官方 openWithQuery）。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchFacets, fetchShelf } from '../api/docs'
import type { ShelfQueryInput } from '../api/docs'
import { ApiError } from '../api/http'
import type { ShelfFacet, ShelfItem, ShelfSort } from '../api/types'
import { MISSING_LABEL, SHELF_PAGE_SIZE, SHELF_SORT_OPTIONS } from '../constants'
import { askWidget } from '../composables/useWidget'
import { trackSearch } from '../composables/useTracking'

const route = useRoute()
const router = useRouter()

// ---------------------------------------------------------------- 状态

interface Filters {
  type: string[]
  org: string[]
  year: string[]
  tag: string[]
}

const filters = reactive<Filters>({ type: [], org: [], year: [], tag: [] })
const keyword = ref(readQueryString('q'))
const sort = ref<ShelfSort>(readSortFromQuery())
const page = ref(1)

const items = ref<readonly ShelfItem[]>([])
const total = ref(0)
const totalPages = ref(0)
const zeroResult = ref(false)
const indexTotal = ref(0)
const facets = reactive({
  types: [] as readonly ShelfFacet[],
  orgs: [] as readonly ShelfFacet[],
  years: [] as readonly ShelfFacet[],
  tags: [] as readonly ShelfFacet[],
})

const loading = ref(false)
const loadError = ref('')

/**
 * T07 埋点：待上报的检索（关键词/筛选）。
 * 只有用户**主动提交搜索**时才置位；zeroResult 要等 /api/docs 回来才知道，
 * 故先记下"这是一次检索"，在 loadList 拿到结果时补齐载荷再上报。
 * 分页/排序/URL 回填触发的加载不会置位，故不会把翻页算成一次检索。
 */
let pendingSearchTrack: { readonly term: string } | null = null

/** 生效筛选（多选维度数量），用于筛选区折叠提示 */
const activeFilterCount = computed(
  () => filters.type.length + filters.org.length + filters.year.length + filters.tag.length,
)

/** 零结果时给「试试问 AI」用的问题：搜索词优先，没有搜索词就用通用兜底句 */
const zeroResultQuestion = computed(() => {
  const text = keyword.value.trim()
  if (text !== '') return `关于「${text}」，知识库里有哪些相关资料和政策依据？`
  const picked = firstPickedLabel()
  return picked === null
    ? '零废弃领域有哪些相关政策？'
    : `关于「${picked}」，有哪些相关政策与实践资料？`
})

function firstPickedLabel(): string | null {
  for (const group of [filters.type, filters.org, filters.year, filters.tag]) {
    const first = group[0]
    if (first !== undefined && first !== '') return first
  }
  return null
}

// ---------------------------------------------------------------- 取数

async function loadFacets(): Promise<void> {
  try {
    const response = await fetchFacets()
    facets.types = response.types
    facets.orgs = response.orgs
    facets.years = response.years
    facets.tags = response.tags
    indexTotal.value = response.total
  } catch (err) {
    // facets 挂了不影响列表主体，只提示一句
    ElMessage.warning(describeError(err, '筛选项加载失败，列表仍可用'))
  }
}

async function loadList(): Promise<void> {
  loading.value = true
  loadError.value = ''
  // 取走并清空标记：这一批数据无论成功失败都只上报一次
  const pending = pendingSearchTrack
  pendingSearchTrack = null
  const query: ShelfQueryInput = {
    type: filters.type,
    org: filters.org,
    year: filters.year,
    tag: filters.tag,
    q: keyword.value.trim(),
    page: page.value,
    pageSize: SHELF_PAGE_SIZE,
    sort: sort.value,
  }
  try {
    const response = await fetchShelf(query)
    items.value = response.items
    total.value = response.total
    totalPages.value = response.totalPages
    zeroResult.value = response.zeroResult
    if (pending !== null) {
      trackSearch({
        term: pending.term,
        total: response.total,
        zeroResult: response.zeroResult,
        filters: {
          type: [...filters.type],
          org: [...filters.org],
          year: [...filters.year],
          tag: [...filters.tag],
        },
      })
    }
  } catch (err) {
    items.value = []
    total.value = 0
    totalPages.value = 0
    zeroResult.value = false
    loadError.value = describeError(err, '书架加载失败')
  } finally {
    loading.value = false
  }
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  return fallback
}

// ---------------------------------------------------------------- 交互

function onSearch(): void {
  page.value = 1
  // T07：主动提交检索才算一次 search 事件（零结果由下面 loadList 回来时补进载荷）
  pendingSearchTrack = { term: keyword.value.trim() }
  void syncUrlAndReload()
}

function onSortChange(): void {
  page.value = 1
  void syncUrlAndReload()
}

function onFilterChange(): void {
  page.value = 1
  void syncUrlAndReload()
}

function clearFilters(): void {
  filters.type = []
  filters.org = []
  filters.year = []
  filters.tag = []
  keyword.value = ''
  page.value = 1
  void syncUrlAndReload()
}

function onPageChange(next: number): void {
  page.value = next
  void syncUrlAndReload()
}

/** 零结果 -> 把当前条件预填进挂件并打开（官方 openWithQuery） */
function askAiAboutZeroResult(): void {
  askWidget(zeroResultQuestion.value)
}

/** 同步 URL（刷新/分享可复现），然后重新拉列表 */
async function syncUrlAndReload(): Promise<void> {
  const query: Record<string, string> = {}
  const text = keyword.value.trim()
  if (text !== '') query['q'] = text
  if (sort.value !== 'year_desc') query['sort'] = sort.value
  for (const value of filters.type) appendMulti(query, 'type', value)
  for (const value of filters.org) appendMulti(query, 'org', value)
  for (const value of filters.year) appendMulti(query, 'year', value)
  for (const value of filters.tag) appendMulti(query, 'tag', value)
  await router.replace({ path: '/shelf', query })
  await loadList()
}

function appendMulti(target: Record<string, string>, key: string, value: string): void {
  target[key] = target[key] === undefined ? value : `${target[key]},${value}`
}

// ---------------------------------------------------------------- 展示辅助

function displayOrMissing(value: string): string {
  return value === '' ? MISSING_LABEL : value
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string | null): string {
  if (value === null || value === '') return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- 路由回填 / 启动

function readQueryString(key: string): string {
  const value = route.query[key]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : ''
}

function readSortFromQuery(): ShelfSort {
  const value = readQueryString('sort')
  const hit = SHELF_SORT_OPTIONS.find((option) => option.value === value)
  return hit?.value ?? 'year_desc'
}

function readFiltersFromQuery(key: string): string[] {
  const value = route.query[key]
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '')
  return String(raw)
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
}

function hydrateFromRoute(): void {
  filters.type = readFiltersFromQuery('type')
  filters.org = readFiltersFromQuery('org')
  filters.year = readFiltersFromQuery('year')
  filters.tag = readFiltersFromQuery('tag')
  keyword.value = readQueryString('q')
  sort.value = readSortFromQuery()
  const pageParam = Number(readQueryString('page'))
  page.value = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1
}

onMounted(() => {
  hydrateFromRoute()
  void loadFacets()
  void loadList()
})

// 浏览器前进/后退时按 URL 回填（不重挂筛选控件，避免循环触发 onFilterChange）
watch(
  () => route.fullPath,
  () => {
    const before = {
      type: filters.type.join(','),
      org: filters.org.join(','),
      year: filters.year.join(','),
      tag: filters.tag.join(','),
      q: keyword.value.trim(),
      sort: sort.value,
      page: String(page.value),
    }
    hydrateFromRoute()
    const after = {
      type: filters.type.join(','),
      org: filters.org.join(','),
      year: filters.year.join(','),
      tag: filters.tag.join(','),
      q: keyword.value.trim(),
      sort: sort.value,
      page: String(page.value),
    }
    const changed = (Object.keys(before) as (keyof typeof before)[]).some(
      (key) => before[key] !== after[key],
    )
    if (changed) void loadList()
  },
)
</script>

<template>
  <div class="shelf">
    <el-card shadow="never" class="filter-card">
      <div class="filter-head">
        <h2 class="filter-title">资料书架</h2>
        <el-space>
          <el-tag type="info" effect="plain">索引共 {{ indexTotal }} 条</el-tag>
          <el-tag v-if="activeFilterCount > 0" type="warning" effect="plain">
            生效筛选 {{ activeFilterCount }} 项
          </el-tag>
          <el-button size="small" @click="clearFilters">清空筛选</el-button>
        </el-space>
      </div>

      <div class="filter-row">
        <el-input
          v-model="keyword"
          class="search-input"
          placeholder="按文件名/标题搜索，如：垃圾分类"
          clearable
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-select v-model="sort" class="sort-select" @change="onSortChange">
          <el-option
            v-for="option in SHELF_SORT_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-button type="primary" @click="onSearch">搜索</el-button>
      </div>

      <el-row class="facet-grid" :gutter="12">
        <el-col :xs="24" :sm="12" :lg="6">
          <div class="facet-label">年份</div>
          <el-select
            v-model="filters.year"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="不限"
            class="facet-select"
            @change="onFilterChange"
          >
            <el-option
              v-for="facet in facets.years"
              :key="facet.value"
              :label="`${displayOrMissing(facet.value)}（${facet.count}）`"
              :value="facet.value"
            />
          </el-select>
        </el-col>
        <el-col :xs="24" :sm="12" :lg="6">
          <div class="facet-label">发布机构</div>
          <el-select
            v-model="filters.org"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="不限"
            class="facet-select"
            @change="onFilterChange"
          >
            <el-option
              v-for="facet in facets.orgs"
              :key="facet.value"
              :label="`${displayOrMissing(facet.value)}（${facet.count}）`"
              :value="facet.value"
            />
          </el-select>
        </el-col>
        <el-col :xs="24" :sm="12" :lg="6">
          <div class="facet-label">知识类型</div>
          <el-select
            v-model="filters.type"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="不限"
            class="facet-select"
            @change="onFilterChange"
          >
            <el-option
              v-for="facet in facets.types"
              :key="facet.value"
              :label="`${displayOrMissing(facet.value)}（${facet.count}）`"
              :value="facet.value"
            />
          </el-select>
        </el-col>
        <el-col :xs="24" :sm="12" :lg="6">
          <div class="facet-label">主题</div>
          <el-select
            v-model="filters.tag"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="不限"
            class="facet-select"
            @change="onFilterChange"
          >
            <el-option
              v-for="facet in facets.tags"
              :key="facet.value"
              :label="`${displayOrMissing(facet.value)}（${facet.count}）`"
              :value="facet.value"
            />
          </el-select>
        </el-col>
      </el-row>
    </el-card>

    <el-alert
      v-if="loadError !== ''"
      class="error-alert"
      type="error"
      show-icon
      :closable="false"
      :title="loadError"
      description="请确认后端在 4000 端口运行（npm run dev:backend），或稍后重试。"
    />

    <el-card v-else shadow="never" class="list-card">
      <template #header>
        <div class="list-head">
          <span>共 {{ total }} 条，第 {{ page }} / {{ Math.max(totalPages, 1) }} 页</span>
        </div>
      </template>

      <div v-loading="loading" class="list-body">
        <!-- 零结果：常驻「试试问 AI」 -->
        <el-empty v-if="!loading && zeroResult" description="没有匹配的资料">
          <div class="zero-ask">
            <p class="zero-text">换个问法试试，AI 助手会带着你当前的关键词去知识库里找：</p>
            <p class="zero-question">{{ zeroResultQuestion }}</p>
            <el-space>
              <el-button type="primary" @click="askAiAboutZeroResult">试试问 AI</el-button>
              <el-button @click="clearFilters">清空筛选再找</el-button>
            </el-space>
          </div>
        </el-empty>

        <el-table v-else-if="items.length > 0" :data="items" stripe style="width: 100%">
          <el-table-column prop="readableTitle" label="标题" min-width="260">
            <template #default="scope">
              <router-link :to="`/doc/${scope.row.id}`" class="doc-link">
                {{ scope.row.readableTitle }}
              </router-link>
            </template>
          </el-table-column>
          <el-table-column label="年份" width="100" prop="year" />
          <el-table-column label="发布机构" min-width="160" prop="org" show-overflow-tooltip />
          <el-table-column label="知识类型" min-width="140" prop="docType" show-overflow-tooltip />
          <el-table-column label="主题" min-width="160">
            <template #default="scope">
              <el-space wrap>
                <el-tag v-for="topic in scope.row.topics" :key="topic" size="small" effect="plain">
                  {{ topic }}
                </el-tag>
                <span v-if="scope.row.topics.length === 0" class="muted">—</span>
              </el-space>
            </template>
          </el-table-column>
          <el-table-column label="大小" width="100">
            <template #default="scope">{{ formatSize(scope.row.fileSize) }}</template>
          </el-table-column>
          <el-table-column label="最近更新" width="120">
            <template #default="scope">{{ formatDate(scope.row.updatedAt) }}</template>
          </el-table-column>
        </el-table>

        <el-empty v-else-if="!loading" description="暂无数据" />
      </div>

      <div v-if="totalPages > 1" class="pager">
        <el-pagination
          layout="prev, pager, next, total"
          :current-page="page"
          :page-size="SHELF_PAGE_SIZE"
          :total="total"
          @current-change="onPageChange"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.shelf {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.filter-title {
  margin: 0;
  font-size: 20px;
}

.filter-row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.search-input {
  max-width: 420px;
}

.sort-select {
  width: 180px;
}

.facet-grid {
  margin-top: 4px;
}

.facet-label {
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.facet-select {
  width: 100%;
}

.error-alert {
  margin: 0;
}

.list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-body {
  min-height: 160px;
}

.doc-link {
  color: var(--el-color-primary);
  text-decoration: none;
}

.muted {
  color: var(--el-text-color-secondary);
}

.zero-ask {
  margin-top: 8px;
}

.zero-text {
  margin: 0 0 6px;
  color: var(--el-text-color-secondary);
}

.zero-question {
  margin: 0 0 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
