<script setup lang="ts">
// 资料书架页（T05）：接 T03 的 /api/docs 与 /api/docs/facets。
// 筛选（年份/机构/类型/主题，多选） + 排序 + 分页 + 文件名搜索。
// 零结果时**常驻**「试试问 AI」，点一下把搜索词预填进挂件（官方 openWithQuery）。
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchFacets, fetchShelf } from '../api/docs'
import type { ShelfQueryInput } from '../api/docs'
import { ApiError } from '../api/http'
import type { ShelfFacet, ShelfItem, ShelfSort } from '../api/types'
import { MISSING_LABEL, SHELF_PAGE_SIZE, SHELF_SORT_OPTIONS } from '../constants'
import { askWidget } from '../composables/useWidget'
import { trackSearch } from '../composables/useTracking'
import { PROXY_BOOKS, type ProxyBook } from '../content/shelf-proxy'

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
const indexTotal = ref(0)
const facets = reactive({
  types: [] as readonly ShelfFacet[],
  orgs: [] as readonly ShelfFacet[],
  years: [] as readonly ShelfFacet[],
  tags: [] as readonly ShelfFacet[],
})

const loading = ref(false)
const loadError = ref('')
const openedBookId = ref<string | null>(null)
const booksPerRow = ref(4)

/** 索引为空时用占位书把书架摆出来；有真实资料后改回接口结果。 */
const usingProxy = computed(() => indexTotal.value === 0 && items.value.length === 0 && loadError.value === '')

interface ShelfBook {
  readonly id: string
  readonly title: string
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
  readonly spine: string
  readonly height: number
  readonly pages: readonly string[]
  readonly proxy: boolean
  readonly detailTo: string | null
}

const displayBooks = computed(() => {
  const source = usingProxy.value ? filterProxyBooks() : items.value.map(toShelfBook)
  return sortBooks(source)
})

interface BookGroup {
  readonly label: string
  readonly rows: ShelfBook[][]
}

const bookGroups = computed((): readonly BookGroup[] => {
  if (usingProxy.value) {
    return [{ label: '', rows: chunkBooks(displayBooks.value) }]
  }
  const grouped = new Map<string, ShelfBook[]>()
  for (const book of displayBooks.value) {
    const label = book.topics[0] === undefined || book.topics[0] === '' ? '未标注' : book.topics[0]
    const list = grouped.get(label) ?? []
    list.push(book)
    grouped.set(label, list)
  }
  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], 'zh'))
    .map(([label, books]) => ({ label, rows: chunkBooks(books) }))
})

function chunkBooks(books: readonly ShelfBook[]): ShelfBook[][] {
  const size = Math.max(booksPerRow.value, 1)
  const rows: ShelfBook[][] = []
  for (let index = 0; index < books.length; index += size) {
    rows.push(books.slice(index, index + size))
  }
  return rows
}

const openedBook = computed(() => displayBooks.value.find((book) => book.id === openedBookId.value) ?? null)

const yearChoices = computed(() => facetChoices(facets.years, (book) => book.year))
const orgChoices = computed(() => facetChoices(facets.orgs, (book) => book.org))
const typeChoices = computed(() => facetChoices(facets.types, (book) => book.docType))
const tagChoices = computed(() => facetChoices(facets.tags, (book) => book.topics))

function facetChoices(
  remote: readonly ShelfFacet[],
  pick: (book: ProxyBook) => string | readonly string[],
): readonly ShelfFacet[] {
  if (!usingProxy.value && remote.length > 0) return remote
  if (!usingProxy.value) return remote
  const counts = new Map<string, number>()
  for (const book of PROXY_BOOKS) {
    const value = pick(book)
    const values = typeof value === 'string' ? [value] : value
    for (const item of values) {
      counts.set(item, (counts.get(item) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value, 'zh'))
}

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
    loadError.value = describeError(err, '书架加载失败')
  } finally {
    loading.value = false
  }
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  return fallback
}

function filterProxyBooks(): readonly ShelfBook[] {
  const text = keyword.value.trim().toLowerCase()
  return PROXY_BOOKS.filter((book) => {
    if (!matchesAny(filters.year, book.year)) return false
    if (!matchesAny(filters.org, book.org)) return false
    if (!matchesAny(filters.type, book.docType)) return false
    if (filters.tag.length > 0 && !book.topics.some((topic) => filters.tag.includes(topic))) return false
    if (text === '') return true
    const haystack = [book.title, book.org, book.docType, book.year, ...book.topics].join(' ').toLowerCase()
    return haystack.includes(text)
  }).map(proxyToShelfBook)
}

function matchesAny(selected: readonly string[], value: string): boolean {
  return selected.length === 0 || selected.includes(value)
}

function proxyToShelfBook(book: ProxyBook): ShelfBook {
  return { ...book, proxy: true, detailTo: null }
}

function toShelfBook(item: ShelfItem): ShelfBook {
  const tone = SPINE_TONES[Math.abs(hashText(item.id)) % SPINE_TONES.length] ?? SPINE_TONES[0]
  return {
    id: item.id,
    title: item.readableTitle,
    year: presentValue(item.year),
    org: presentValue(item.org),
    docType: presentValue(item.docType),
    topics: item.topics,
    spine: tone,
    height: 156 + (Math.abs(hashText(item.id)) % 5) * 8,
    pages: [
      [item.org, item.year, item.docType].filter((part) => part !== '').join(' · '),
      item.topics.length > 0 ? `标签：${item.topics.join('、')}` : '标签未标注',
      '点击下方入口可打开这条资料的详情、预览和下载。',
    ].filter((line) => line !== ''),
    proxy: false,
    detailTo: `/doc/${item.id}`,
  }
}

const SPINE_TONES = ['#1f6b4a', '#8c3a3a', '#3d4f7c', '#8a6232', '#6b3a4a', '#1e4d6b', '#4a3f35']

function presentValue(value: string): string {
  return value === '' || value === MISSING_LABEL ? '' : value
}

function hashText(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return hash
}

function sortBooks(books: readonly ShelfBook[]): readonly ShelfBook[] {
  const copy = [...books]
  copy.sort((left, right) => {
    if (sort.value === 'year_asc') return left.year.localeCompare(right.year, 'zh')
    if (sort.value === 'title_asc') return left.title.localeCompare(right.title, 'zh')
    if (sort.value === 'updated_desc') return right.year.localeCompare(left.year, 'zh')
    return right.year.localeCompare(left.year, 'zh')
  })
  return copy
}

function measureShelf(): void {
  const width = window.innerWidth
  booksPerRow.value = width >= 1100 ? 8 : width >= 760 ? 6 : 4
}

function toggleBook(id: string): void {
  openedBookId.value = openedBookId.value === id ? null : id
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
  if (usingProxy.value) {
    ElMessage.info('库内还没有正式 PDF，这个问题没有依据，不能回答。')
    return
  }
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
  measureShelf()
  window.addEventListener('resize', measureShelf)
  hydrateFromRoute()
  void loadFacets()
  void loadList()
})

onUnmounted(() => {
  window.removeEventListener('resize', measureShelf)
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
              v-for="facet in yearChoices"
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
              v-for="facet in orgChoices"
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
              v-for="facet in typeChoices"
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
              v-for="facet in tagChoices"
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
          <span v-if="usingProxy">占位书架 {{ displayBooks.length }} 本</span>
          <span v-else>共 {{ total }} 条，第 {{ page }} / {{ Math.max(totalPages, 1) }} 页</span>
        </div>
      </template>

      <div v-loading="loading" class="list-body">
        <el-empty v-if="!loading && displayBooks.length === 0" description="没有匹配的资料">
          <div class="zero-ask">
            <p class="zero-text">换个问法试试，AI 助手会带着你当前的关键词去知识库里找：</p>
            <p class="zero-question">{{ zeroResultQuestion }}</p>
            <el-space>
              <el-button type="primary" @click="askAiAboutZeroResult">试试问 AI</el-button>
              <el-button @click="clearFilters">清空筛选再找</el-button>
            </el-space>
          </div>
        </el-empty>

        <template v-else>
          <p v-if="usingProxy" class="proxy-note">
            这 {{ displayBooks.length }} 本是占位书，用来演示筛选和点开。正式 PDF 入库后会出现在同一位置，可以预览和下载原文。占位文字不能当作答案。
          </p>
          <section v-for="group in bookGroups" :key="group.label || 'all'" class="tag-group">
            <h3 v-if="group.label !== ''" class="tag-heading">{{ group.label }}</h3>
          <div class="bookcase">
            <div v-for="(row, rowIndex) in group.rows" :key="rowIndex" class="shelf-row">
              <div class="books">
                <button
                  v-for="book in row"
                  :key="book.id"
                  type="button"
                  class="book"
                  :class="{ open: openedBookId === book.id }"
                  :style="{ background: book.spine, height: `${book.height}px` }"
                  :aria-expanded="openedBookId === book.id"
                  @click="toggleBook(book.id)"
                >
                  <span class="spine-title">{{ book.title }}</span>
                  <span class="spine-year">{{ book.year !== '' ? book.year : (book.topics[0] ?? '') }}</span>
                </button>
              </div>
              <div class="plank"></div>
            </div>
          </div>
          </section>

          <article v-if="openedBook" class="open-book">
            <div class="open-cover" :style="{ background: openedBook.spine }">
              <p class="open-kicker">{{ openedBook.proxy ? '占位书' : '资料' }}</p>
              <h3>{{ openedBook.title }}</h3>
              <p v-if="openedBook.year !== '' || openedBook.org !== ''">
                {{ [openedBook.year, openedBook.org].filter((part) => part !== '').join(' · ') }}
              </p>
            </div>
            <div class="open-pages">
              <p class="open-meta">
                {{
                  [openedBook.docType, openedBook.topics.join('、')]
                    .filter((part) => part !== '')
                    .join(' · ') || '未标注'
                }}
              </p>
              <template v-if="openedBook.proxy">
                <p>这是占位书，不是正式资料。</p>
                <p>正式 PDF 入库后，这里可以预览和下载原文。</p>
              </template>
              <p v-for="(paragraph, index) in openedBook.pages" v-else :key="index">{{ paragraph }}</p>
              <router-link v-if="openedBook.detailTo" :to="openedBook.detailTo">
                <el-button type="primary" size="small">打开资料详情</el-button>
              </router-link>
              <el-button v-else size="small" @click="openedBookId = null">合上</el-button>
            </div>
          </article>
        </template>
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
  padding-left: 10px;
  border-left: 4px solid var(--zw-green);
  color: var(--zw-ink);
  font-size: 20px;
  font-weight: 700;
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
  min-height: 220px;
}

.proxy-note {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.tag-group + .tag-group {
  margin-top: 18px;
}

.tag-heading {
  margin: 0 0 8px;
  font-size: 16px;
  color: var(--zw-green);
}

.bookcase {
  padding: 18px 12px 8px;
  background:
    linear-gradient(180deg, #4a3424 0%, #3a281c 100%);
  border: 1px solid #2b1c14;
}

.shelf-row {
  position: relative;
  margin-bottom: 18px;
}

.books {
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  gap: 8px;
  min-height: 168px;
  padding: 0 10px;
}

.book {
  position: relative;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  width: 0;
  max-width: 72px;
  min-width: 0;
  padding: 12px 4px 10px;
  border: 0;
  border-radius: 2px 4px 2px 2px;
  box-shadow:
    inset -6px 0 0 rgba(0, 0, 0, 0.18),
    1px 0 0 rgba(255, 255, 255, 0.18);
  color: #fff;
  cursor: pointer;
  transform-origin: bottom center;
  transition: transform 0.16s ease;
}

.book:hover,
.book.open {
  transform: translateY(-12px);
  z-index: 1;
}

.book.open {
  outline: 2px solid #f3e2c2;
}

.spine-title {
  writing-mode: vertical-rl;
  max-height: 118px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 1.15;
}

.spine-year {
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.85;
}

.plank {
  height: 14px;
  margin-top: -2px;
  background: linear-gradient(180deg, #e6c48a 0%, #b8884e 45%, #8b6233 100%);
  box-shadow: 0 8px 10px rgba(0, 0, 0, 0.28);
}

.open-book {
  display: grid;
  grid-template-columns: 180px 1fr;
  min-height: 220px;
  margin-top: 16px;
  border: 1px solid var(--zw-line);
  background: #f7f1e6;
}

.open-cover {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 8px;
  padding: 18px 16px;
  color: #fff;
}

.open-cover h3,
.open-cover p {
  margin: 0;
}

.open-cover h3 {
  font-size: 20px;
  line-height: 1.35;
}

.open-kicker {
  font-size: 12px;
  letter-spacing: 0.14em;
}

.open-pages {
  padding: 18px 20px;
  color: var(--zw-ink);
  line-height: 1.75;
}

.open-pages p {
  margin: 0 0 10px;
}

.open-meta {
  color: var(--zw-muted);
  font-size: 13px;
}

@media (max-width: 640px) {
  .open-book {
    grid-template-columns: 1fr;
  }

  .open-cover {
    min-height: 120px;
  }

  .spine-title {
    max-height: 96px;
    font-size: 12px;
  }
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
