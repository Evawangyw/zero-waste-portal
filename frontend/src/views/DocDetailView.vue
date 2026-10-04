<script setup lang="ts">
// 资料详情页（T05）：接 T04 的 /api/docs/:id、/preview、/download。
// 下载按钮先查登录态：未登录跳 /auth?redirect=当前页（登录后回跳再来下载）。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchDocDetail, fetchDocDownload, fetchDocPreview } from '../api/docs'
import { ApiError } from '../api/http'
import type { DocDetailResponse, PreviewAvailability } from '../api/types'
import { MISSING_LABEL } from '../constants'
import { authToken, currentUser, isLoggedIn } from '../composables/useAuth'

const route = useRoute()
const router = useRouter()

const docId = computed(() => String(route.params['id'] ?? ''))

const detail = ref<DocDetailResponse | null>(null)
const loading = ref(false)
const loadError = ref('')

/** 预览 */
const previewUrl = ref('')
const previewUnavailableReason = ref('')
const previewLoading = ref(false)

/** 下载 */
const downloading = ref(false)
/** 未登录时记下用户点的是哪个文件，登录回跳后可直接续下 */
const pendingDownloadName = ref('')

const preview = computed<PreviewAvailability | null>(() => detail.value?.preview ?? null)
const isPreviewable = computed(() => preview.value?.streamable === true)
const downloadFileName = computed(() => detail.value?.download.fileName ?? '')

onMounted(() => {
  void loadDetail()
})

async function loadDetail(): Promise<void> {
  if (docId.value === '') {
    loadError.value = '缺少资料 id'
    return
  }
  loading.value = true
  loadError.value = ''
  detail.value = null
  releasePreviewUrl()
  try {
    detail.value = await fetchDocDetail(docId.value)
    await loadPreview()
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : '资料加载失败'
  } finally {
    loading.value = false
  }
}

/** 预览：能内联渲染（PDF/图片/文本）就直接开流，不能则读信封给出下载引导 */
async function loadPreview(): Promise<void> {
  if (detail.value === null) return
  if (!isPreviewable.value) {
    previewUnavailableReason.value =
      detail.value.preview.reason ?? '该资料不支持在线预览，可下载后查看'
    return
  }
  previewLoading.value = true
  try {
    const response = await fetchDocPreview(docId.value)
    const blob = await response.blob()
    previewUrl.value = URL.createObjectURL(blob)
    previewUnavailableReason.value = ''
  } catch (err) {
    // 预览失败不阻断详情页：给一句原因 + 下载按钮兜底
    previewUnavailableReason.value =
      err instanceof ApiError ? err.message : '预览加载失败，可下载后查看'
  } finally {
    previewLoading.value = false
  }
}

/**
 * 下载：后端强制登录（写下载日志），故先查登录态。
 * 未登录 -> 记下文件名，跳登录页并带 redirect，登录成功后回跳本页再点下载即可。
 */
function onDownload(): void {
  if (!isLoggedIn.value) {
    pendingDownloadName.value = detail.value?.doc.readableTitle ?? ''
    ElMessage.warning('下载需要先登录，已为你跳到登录页')
    void router.push({ path: '/auth', query: { redirect: route.fullPath } })
    return
  }
  void doDownload()
}

async function doDownload(): Promise<void> {
  const token = authToken()
  if (token === null) {
    ElMessage.warning('登录态已失效，请重新登录')
    void router.push({ path: '/auth', query: { redirect: route.fullPath } })
    return
  }
  downloading.value = true
  try {
    const response = await fetchDocDownload(docId.value, token)
    const blob = await response.blob()
    triggerBrowserDownload(blob, downloadFileName.value)
    ElMessage.success('已开始下载')
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) {
      ElMessage.warning('登录态已失效，请重新登录')
      void router.push({ path: '/auth', query: { redirect: route.fullPath } })
      return
    }
    ElMessage.error(err instanceof ApiError ? err.message : '下载失败，请稍后重试')
  } finally {
    downloading.value = false
  }
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName === '' ? 'download' : fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 立刻 revoke 会让部分浏览器下载空文件，延后一拍
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 10_000)
}

function releasePreviewUrl(): void {
  if (previewUrl.value !== '') {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
}

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
</script>

<template>
  <div v-loading="loading" class="detail">
    <el-alert
      v-if="loadError !== ''"
      type="error"
      show-icon
      :closable="false"
      title="资料加载失败"
      :description="loadError"
    >
      <template #default>
        <el-button size="small" @click="router.push('/shelf')">返回书架</el-button>
        <el-button size="small" type="primary" plain @click="loadDetail">重试</el-button>
      </template>
    </el-alert>

    <template v-else-if="detail !== null">
      <el-card shadow="never" class="head-card">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
          <el-breadcrumb-item :to="{ path: '/shelf' }">资料书架</el-breadcrumb-item>
          <el-breadcrumb-item>{{ detail.doc.readableTitle }}</el-breadcrumb-item>
        </el-breadcrumb>

        <h1 class="doc-title">{{ detail.doc.readableTitle }}</h1>
        <p v-if="detail.doc.fileName !== ''" class="doc-file">
          原文件名：{{ detail.doc.fileName }}
        </p>

        <el-space wrap class="doc-tags">
          <el-tag effect="plain">年份：{{ displayOrMissing(detail.metadata.year) }}</el-tag>
          <el-tag effect="plain">机构：{{ displayOrMissing(detail.metadata.org) }}</el-tag>
          <el-tag effect="plain">类型：{{ displayOrMissing(detail.metadata.docType) }}</el-tag>
          <el-tag v-if="detail.metadataComplete" type="success" effect="plain">标注齐全</el-tag>
          <el-tag v-else type="info" effect="plain">部分维度未标注</el-tag>
          <el-tag v-for="topic in detail.metadata.topics" :key="topic" size="small" effect="plain">
            {{ topic }}
          </el-tag>
        </el-space>

        <el-descriptions class="doc-meta" :column="3" border size="small">
          <el-descriptions-item label="文件类型">
            {{ detail.doc.fileType === '' ? '未知' : detail.doc.fileType }}
          </el-descriptions-item>
          <el-descriptions-item label="文件大小">{{
            formatSize(detail.doc.fileSize)
          }}</el-descriptions-item>
          <el-descriptions-item label="解析状态">{{
            detail.doc.parseStatus || '—'
          }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{
            formatDate(detail.doc.createdAt)
          }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{
            formatDate(detail.doc.updatedAt)
          }}</el-descriptions-item>
          <el-descriptions-item label="数据来源">{{ detail.source }}</el-descriptions-item>
        </el-descriptions>

        <div class="actions">
          <el-button
            type="primary"
            :disabled="!isPreviewable"
            :loading="previewLoading"
            @click="loadPreview"
          >
            在线预览
          </el-button>
          <el-button type="success" :loading="downloading" @click="onDownload">
            {{ isLoggedIn ? '下载资料' : '下载（需登录）' }}
          </el-button>
          <span class="download-hint">将下载为：{{ downloadFileName }}</span>
          <span v-if="!isLoggedIn" class="login-hint">
            当前未登录（{{ currentUser ? currentUser.name : '访客' }}）
          </span>
        </div>

        <el-alert
          v-if="pendingDownloadName !== '' && !isLoggedIn"
          class="pending-alert"
          type="info"
          show-icon
          :closable="false"
          title="已记下你的下载意图"
          :description="`登录后回到本页再点一次「下载」即可继续（目标：${pendingDownloadName}）。`"
        />
      </el-card>

      <el-card v-if="detail.doc.summary !== null || detail.doc.gist !== null" shadow="never">
        <template #header><strong>摘要</strong></template>
        <p v-if="detail.doc.gist !== null" class="gist">{{ detail.doc.gist }}</p>
        <p v-if="detail.doc.summary !== null" class="summary">{{ detail.doc.summary }}</p>
      </el-card>

      <el-card shadow="never">
        <template #header><strong>预览</strong></template>

        <div v-if="previewUnavailableReason !== ''" class="preview-fallback">
          <p class="fallback-reason">{{ previewUnavailableReason }}</p>
          <el-button type="primary" plain @click="onDownload">改为下载查看</el-button>
        </div>

        <div v-else-if="isPreviewable" v-loading="previewLoading" class="preview-box">
          <iframe
            v-if="previewUrl !== ''"
            :src="previewUrl"
            class="preview-frame"
            title="资料预览"
          />
          <p v-else class="muted">预览加载中…</p>
        </div>

        <el-empty v-else description="该资料暂不支持在线预览" />
      </el-card>

      <el-card v-if="detail.doc.tags.length > 0" shadow="never">
        <template #header><strong>知识库标签</strong></template>
        <el-space wrap>
          <el-tag v-for="tag in detail.doc.tags" :key="tag" size="small">{{ tag }}</el-tag>
        </el-space>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.doc-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.4;
}

.doc-file {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.doc-meta {
  margin-top: 4px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.download-hint,
.login-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.pending-alert {
  margin: 0;
}

.gist {
  margin: 0 0 8px;
  font-weight: 600;
}

.summary,
.fallback-reason {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}

.preview-fallback {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.preview-box {
  min-height: 420px;
}

.preview-frame {
  width: 100%;
  height: 640px;
  border: 1px solid var(--el-border-color-light);
}

.muted {
  color: var(--el-text-color-secondary);
}
</style>
