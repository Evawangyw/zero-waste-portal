<script setup lang="ts">
// 资料管理：表格列出书架资料，可上传、上下架、按当前筛选导出。
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchAdminShelf, setAdminDocListed, uploadAdminDocument } from '../../api/admin'
import { ApiError } from '../../api/http'
import type { AdminShelfItem } from '../../api/types'
import { authToken } from '../../composables/useAuth'
import { downloadCsv } from '../../utils/export-csv'

const PAGE_SIZE = 20
const EXPORT_PAGE_SIZE = 50

const items = ref<AdminShelfItem[]>([])
const total = ref(0)
const page = ref(1)
const query = ref('')
const filter = ref<'1' | '0' | 'all'>('all')
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const busyId = ref('')

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

let queryTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  void load()
})

onUnmounted(() => {
  if (queryTimer !== undefined) clearTimeout(queryTimer)
})

async function load(): Promise<void> {
  const token = authToken()
  if (token === null) return
  loading.value = true
  error.value = ''
  try {
    const result = await fetchAdminShelf(token, {
      q: query.value.trim(),
      listed: filter.value,
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    items.value = [...result.items]
    total.value = result.total
    page.value = result.page
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '资料列表加载失败'
  } finally {
    loading.value = false
  }
}

function onQueryInput(): void {
  if (queryTimer !== undefined) clearTimeout(queryTimer)
  queryTimer = setTimeout(() => {
    queryTimer = undefined
    page.value = 1
    void load()
  }, 300)
}

function setFilter(next: '1' | '0' | 'all'): void {
  filter.value = next
  page.value = 1
  void load()
}

function onPage(next: number): void {
  page.value = next
  void load()
}

async function toggleListed(row: AdminShelfItem): Promise<void> {
  const token = authToken()
  if (token === null || busyId.value !== '') return
  busyId.value = row.id
  const nextListed = !row.listed
  try {
    await setAdminDocListed(token, row.id, nextListed)
    ElMessage.success(nextListed ? `《${row.title}》已上架` : `《${row.title}》已下架`)
    await load()
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败')
  } finally {
    busyId.value = ''
  }
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
    page.value = 1
    filter.value = 'all'
    await load()
  } catch (err) {
    uploadError.value = err instanceof ApiError ? err.message : '上传失败'
  } finally {
    uploadBusy.value = false
  }
}

async function exportTable(): Promise<void> {
  const token = authToken()
  if (token === null || exporting.value) return
  exporting.value = true
  try {
    const rows: AdminShelfItem[] = []
    let nextPage = 1
    let expected = Number.POSITIVE_INFINITY
    while (rows.length < expected) {
      const result = await fetchAdminShelf(token, {
        q: query.value.trim(),
        listed: filter.value,
        page: nextPage,
        pageSize: EXPORT_PAGE_SIZE,
      })
      expected = result.total
      rows.push(...result.items)
      if (result.items.length === 0) break
      nextPage += 1
    }
    downloadCsv(
      '资料管理.csv',
      ['标题', '年份', '机构', '知识类型', '状态', '编号'],
      rows.map((row) => [
        row.title,
        row.year,
        row.org,
        row.docType,
        row.listed ? '已上架' : '已下架',
        row.id,
      ]),
    )
    ElMessage.success(`已导出 ${rows.length} 条`)
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '导出失败')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="docs-page">
    <header class="head">
      <div>
        <h2>资料管理</h2>
        <p>下架后公众书架不再显示，也不能打开或下载。文件还在，可以再上架。导出的是当前筛选结果。</p>
      </div>
      <div class="actions">
        <el-button :loading="exporting" @click="exportTable">导出表格</el-button>
        <el-button type="primary" @click="openUploadPicker">上传资料</el-button>
      </div>
    </header>

    <input
      ref="fileInput"
      class="upload-input"
      type="file"
      accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf"
      @change="onUploadPicked"
    />

    <el-dialog
      v-model="uploadOpen"
      title="上传资料"
      width="min(480px, calc(100vw - 24px))"
      :close-on-click-modal="!uploadBusy"
      :show-close="!uploadBusy"
      @close="closeUpload"
    >
      <p class="upload-file">{{ uploadFile?.name }}</p>
      <p class="note">上传后用 SoMark 转成 Markdown，写入书架和问答。页数多时会多等一会儿。</p>
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

    <div class="tools">
      <el-input v-model="query" clearable placeholder="搜标题、文件名或机构" class="search" @input="onQueryInput" />
      <el-button :type="filter === '1' ? 'primary' : 'default'" @click="setFilter('1')">已上架</el-button>
      <el-button :type="filter === '0' ? 'primary' : 'default'" @click="setFilter('0')">已下架</el-button>
      <el-button :type="filter === 'all' ? 'primary' : 'default'" @click="setFilter('all')">全部</el-button>
    </div>

    <el-alert v-if="error !== ''" type="error" :closable="false" :title="error" />

    <el-table v-loading="loading" :data="items" size="small" empty-text="没有符合的资料">
      <el-table-column prop="title" label="标题" min-width="220" />
      <el-table-column prop="year" label="年份" width="90" />
      <el-table-column prop="org" label="机构" min-width="140" />
      <el-table-column prop="docType" label="知识类型" min-width="120" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">{{ row.listed ? '已上架' : '已下架' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button
            size="small"
            :type="row.listed ? 'warning' : 'primary'"
            :loading="busyId === row.id"
            @click="toggleListed(row)"
          >
            {{ row.listed ? '下架' : '上架' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="total > PAGE_SIZE" class="pager">
      <el-pagination
        layout="prev, pager, next, total"
        :current-page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        @current-change="onPage"
      />
    </div>
  </div>
</template>

<style scoped>
.docs-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.head,
.actions,
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
}

.head {
  justify-content: space-between;
}

h2 {
  margin: 0 0 6px;
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 26px;
}

.head p,
.note,
.upload-file {
  margin: 0;
  color: var(--muted);
  line-height: 1.6;
}

.search {
  width: 280px;
  max-width: 100%;
}

.upload-input {
  display: none;
}

.pager {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .head,
  .actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
