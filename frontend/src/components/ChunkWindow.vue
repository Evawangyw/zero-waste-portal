<script setup lang="ts">
// 管理统计里的独立切片窗口：左边选资料，右边翻这一份的正文切片。
import { computed, ref, watch } from 'vue'
import { fetchChunkDocuments, fetchChunkPage } from '../api/admin'
import { ApiError } from '../api/http'
import type { ChunkDocumentItem, ChunkPageItem } from '../api/types'
import { authToken } from '../composables/useAuth'

const open = defineModel<boolean>({ required: true })

const PAGE_SIZE = 8

const documents = ref<ChunkDocumentItem[]>([])
const query = ref('')
const selectedId = ref<number | null>(null)
const items = ref<ChunkPageItem[]>([])
const title = ref('')
const total = ref(0)
const page = ref(1)
const loadingDocs = ref(false)
const loadingChunks = ref(false)
const error = ref('')
let chunkTicket = 0

const filtered = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (term === '') return documents.value
  return documents.value.filter((doc) =>
    `${doc.title} ${doc.organization} ${doc.year}`.toLowerCase().includes(term),
  )
})

watch(open, (shown) => {
  if (shown && documents.value.length === 0 && !loadingDocs.value) void loadDocuments()
})

async function loadDocuments(): Promise<void> {
  const token = authToken()
  if (token === null) return
  loadingDocs.value = true
  error.value = ''
  try {
    const payload = await fetchChunkDocuments(token)
    documents.value = payload.documents.map((doc) => ({ ...doc }))
    const first = documents.value[0]
    if (selectedId.value === null && first !== undefined) await selectDocument(first.documentId)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '资料列表加载失败'
  } finally {
    loadingDocs.value = false
  }
}

async function selectDocument(documentId: number): Promise<void> {
  selectedId.value = documentId
  page.value = 1
  await loadChunks()
}

async function loadChunks(): Promise<void> {
  const token = authToken()
  const documentId = selectedId.value
  if (token === null || documentId === null) return
  const ticket = ++chunkTicket
  loadingChunks.value = true
  error.value = ''
  try {
    const payload = await fetchChunkPage(token, documentId, page.value, PAGE_SIZE)
    if (ticket !== chunkTicket) return
    title.value = payload.title
    total.value = payload.total
    items.value = payload.items.map((item) => ({ ...item }))
  } catch (err) {
    if (ticket !== chunkTicket) return
    items.value = []
    total.value = 0
    error.value = err instanceof ApiError ? err.message : '切片加载失败'
  } finally {
    if (ticket === chunkTicket) loadingChunks.value = false
  }
}

function onPage(next: number): void {
  page.value = next
  void loadChunks()
}

function pieceLabel(index: number): string {
  return `片段 ${index + 1}`
}
</script>

<template>
  <el-dialog
    v-model="open"
    class="chunk-window"
    title="正文切片"
    width="min(1040px, 96vw)"
    top="6vh"
    append-to-body
    destroy-on-close
  >
    <p v-if="error !== ''" class="chunk-error">{{ error }}</p>
    <div v-loading="loadingDocs || loadingChunks" class="chunk-layout">
      <aside class="chunk-docs">
        <el-input v-model="query" clearable placeholder="按标题、机构或年份找资料" />
        <div class="chunk-doc-list">
          <button
            v-for="doc in filtered"
            :key="doc.documentId"
            type="button"
            class="chunk-doc"
            :class="{ active: doc.documentId === selectedId }"
            @click="selectDocument(doc.documentId)"
          >
            <b>{{ doc.title }}</b>
            <small>{{ doc.chunkCount }} 个切片 · {{ doc.year || '年份未注明' }}</small>
          </button>
          <p v-if="!loadingDocs && filtered.length === 0" class="chunk-empty">没有匹配的资料</p>
        </div>
      </aside>
      <section class="chunk-body">
        <header class="chunk-head">
          <div>
            <h3>{{ title || '选择一份资料' }}</h3>
            <span v-if="selectedId !== null">共 {{ total }} 个切片</span>
          </div>
        </header>
        <div class="chunk-list">
          <article v-for="item in items" :key="item.chunkId" class="chunk-card">
            <span>{{ pieceLabel(item.chunkIndex) }}</span>
            <p>{{ item.content }}</p>
          </article>
          <p v-if="!loadingChunks && selectedId !== null && items.length === 0" class="chunk-empty">
            这份资料没有切片
          </p>
        </div>
        <el-pagination
          v-if="total > PAGE_SIZE"
          class="chunk-pager"
          background
          layout="prev, pager, next"
          :total="total"
          :page-size="PAGE_SIZE"
          :current-page="page"
          @current-change="onPage"
        />
      </section>
    </div>
  </el-dialog>
</template>

<style>
.chunk-window .el-dialog__body {
  padding-top: 8px;
}

.chunk-window .chunk-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  height: min(68vh, 720px);
  min-height: 420px;
}

.chunk-window .chunk-docs,
.chunk-window .chunk-body {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chunk-window .chunk-doc-list,
.chunk-window .chunk-list {
  overflow: auto;
  min-height: 0;
}

.chunk-window .chunk-doc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}

.chunk-window .chunk-doc {
  text-align: left;
  border: 1px solid #d7eadf;
  background: #fff;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
}

.chunk-window .chunk-doc b,
.chunk-window .chunk-doc small {
  display: block;
}

.chunk-window .chunk-doc b {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.45;
}

.chunk-window .chunk-doc small {
  margin-top: 3px;
  color: #6b7280;
  font-size: 12px;
}

.chunk-window .chunk-doc.active {
  border-color: #017c40;
  background: #f4faf6;
}

.chunk-window .chunk-head h3 {
  margin: 0;
  font-size: 16px;
}

.chunk-window .chunk-head span {
  display: block;
  margin-top: 4px;
  color: #6b7280;
  font-size: 12px;
}

.chunk-window .chunk-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chunk-window .chunk-card {
  border: 1px solid #d7eadf;
  background: #f4faf6;
  border-radius: 8px;
  padding: 12px 14px;
}

.chunk-window .chunk-card span {
  color: #017c40;
  font-size: 12px;
  font-weight: 700;
}

.chunk-window .chunk-card p {
  margin: 6px 0 0;
  white-space: pre-wrap;
  line-height: 1.7;
  font-size: 14px;
}

.chunk-window .chunk-pager {
  justify-content: flex-end;
}

.chunk-window .chunk-empty,
.chunk-window .chunk-error {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
}

.chunk-window .chunk-error {
  margin-bottom: 8px;
  color: var(--el-color-danger);
}

@media (max-width: 800px) {
  .chunk-window .chunk-layout {
    grid-template-columns: 1fr;
    height: auto;
  }

  .chunk-window .chunk-doc-list {
    max-height: 180px;
  }

  .chunk-window .chunk-list {
    max-height: 46vh;
  }
}
</style>
