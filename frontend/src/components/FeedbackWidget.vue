<script setup lang="ts">
// 右下角反馈入口。分类和描述交给 POST /api/feedback，同时记一条 feedback_submit 埋点。
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { FEEDBACK_CATEGORIES, submitFeedback } from '../api/feedback'
import type { FeedbackCategoryKey } from '../api/feedback'
import { ApiError } from '../api/http'
import { authToken } from '../composables/useAuth'
import { trackFeedback } from '../composables/useTracking'

const route = useRoute()
const open = ref(false)
const category = ref<FeedbackCategoryKey | ''>('')
const description = ref('')
const submitting = ref(false)
const formError = ref('')

const lifted = computed(() => route.name === 'ask')

function isCategory(value: string): value is FeedbackCategoryKey {
  return FEEDBACK_CATEGORIES.some((item) => item.key === value)
}

function resetForm(): void {
  category.value = ''
  description.value = ''
  formError.value = ''
}

async function submit(): Promise<void> {
  const picked = category.value
  const text = description.value.trim()
  if (!isCategory(picked)) {
    formError.value = '请选择问题分类'
    return
  }
  if (text.length < 2) {
    formError.value = '请把问题写具体一点（至少 2 个字）'
    return
  }
  submitting.value = true
  formError.value = ''
  try {
    await submitFeedback({ category: picked, description: text, pagePath: route.fullPath }, authToken())
    trackFeedback({ category: picked })
    ElMessage.success('已收到，谢谢反馈')
    open.value = false
    resetForm()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : '提交失败，请稍后再试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <button
      type="button"
      class="feedback-fab"
      :class="{ lifted }"
      aria-label="问题反馈"
      title="问题反馈"
      @click="open = true"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M6 6.5A2.5 2.5 0 0 1 8.5 4h7A2.5 2.5 0 0 1 18 6.5v6A2.5 2.5 0 0 1 15.5 15H11l-3.2 2.8c-.4.35-1 .05-1-.45V15H8.5A2.5 2.5 0 0 1 6 12.5v-6z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </Teleport>

  <el-dialog
    v-model="open"
    title="问题反馈"
    class="feedback-dialog"
    width="min(440px, calc(100vw - 24px))"
    :close-on-click-modal="!submitting"
    :show-close="!submitting"
    @closed="formError = ''"
  >
    <p class="feedback-hint">选一个分类，再写下具体问题。会记下你当前所在的页面，方便定位。</p>
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="问题分类" required>
        <el-select v-model="category" placeholder="请选择" style="width: 100%" :disabled="submitting">
          <el-option v-for="item in FEEDBACK_CATEGORIES" :key="item.key" :label="item.label" :value="item.key" />
        </el-select>
      </el-form-item>
      <el-form-item label="具体问题" required>
        <el-input
          v-model="description"
          type="textarea"
          :rows="5"
          maxlength="2000"
          show-word-limit
          placeholder="发生了什么、你希望怎样"
          :disabled="submitting"
        />
      </el-form-item>
    </el-form>
    <p v-if="authToken() === null" class="feedback-hint">未登录也可以提交。登录后再提交，管理员能看到你的姓名。</p>
    <el-alert v-if="formError !== ''" type="error" :closable="false" :title="formError" />
    <template #footer>
      <el-button :disabled="submitting" @click="open = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">提交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.feedback-fab {
  position: fixed;
  right: 20px;
  bottom: calc(22px + env(safe-area-inset-bottom));
  z-index: 30;
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--forest, #285c49);
  color: #fff;
  box-shadow: 0 10px 24px rgba(25, 68, 54, 0.28);
  cursor: pointer;
}

.feedback-fab:hover {
  background: var(--forest-deep, #194436);
}

.feedback-fab.lifted {
  bottom: calc(108px + env(safe-area-inset-bottom));
}
</style>

<style>
.feedback-dialog .feedback-hint {
  margin: 0 0 12px;
  color: #6f7772;
  font-size: 13px;
  line-height: 1.6;
}

.feedback-dialog .el-alert {
  margin-top: 4px;
}
</style>
