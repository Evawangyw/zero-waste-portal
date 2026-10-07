<script setup lang="ts">
// 登录后的首页只保留向知识库提问。问题交给官方挂件，不在本页自写问答窗口。
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { SAMPLE_QUESTIONS } from '../constants'
import { fetchShelfTotal } from '../api/docs'
import {
  askWidget,
  flushPendingQuery,
  mountWidget,
  openWidget,
  widgetError,
  widgetStatus,
} from '../composables/useWidget'
import { isLoggedIn } from '../composables/useAuth'
import FoundationView from './FoundationView.vue'

const customQuestion = ref('')
/** 本站索引还没有正式 PDF。这时不能把问题交给模型，否则会编出没有依据的政策。 */
const libraryEmpty = ref(false)
const unanswered = ref('')

onMounted(() => {
  if (!isLoggedIn.value) return
  startMemberHome()
})

watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) startMemberHome()
})

function startMemberHome(): void {
  window.setTimeout(() => {
    flushPendingQuery()
  }, 800)
  void mountWidget()
  void loadLibraryState()
}

async function loadLibraryState(): Promise<void> {
  try {
    libraryEmpty.value = (await fetchShelfTotal()) === 0
  } catch {
    libraryEmpty.value = false
  }
}

function onSampleQuestion(text: string): void {
  submitQuestion(text)
}

function onCustomAsk(): void {
  submitQuestion(customQuestion.value)
}

function submitQuestion(raw: string): void {
  const text = raw.trim()
  if (text === '') {
    ElMessage.warning('请先输入你的问题')
    return
  }
  if (libraryEmpty.value) {
    unanswered.value = text
    void openWidget()
    return
  }
  unanswered.value = ''
  askWidget(text)
}

</script>

<template>
  <FoundationView v-if="!isLoggedIn" />
  <div v-else class="home">
    <el-card class="ask-card" shadow="never">
      <template #header>向知识库提问</template>

      <div class="custom-ask">
        <el-input
          v-model="customQuestion"
          placeholder="例如：社区厨余堆肥活动怎么设计？"
          clearable
          @keyup.enter="onCustomAsk"
        />
        <el-button type="primary" @click="onCustomAsk">向 AI 提问</el-button>
      </div>

      <div class="samples">
        <el-button
          v-for="item in SAMPLE_QUESTIONS"
          :key="item.text"
          plain
          @click="onSampleQuestion(item.text)"
        >
          {{ item.text }}
        </el-button>
      </div>

      <div v-if="unanswered !== ''" class="empty-answer">
        <p class="empty-q">{{ unanswered }}</p>
        <p>库内暂未收录正式资料，所以不能回答。</p>
        <p>占位书架里的文字不是答案。正式 PDF 入库后，助手会按库内资料回答，并标出来源。</p>
      </div>

      <el-alert
        v-if="widgetStatus === 'error'"
        class="widget-alert"
        type="warning"
        show-icon
        :closable="false"
        title="AI 暂时不可用，请稍后再试"
        :description="widgetError"
      />
    </el-card>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
}

.custom-ask {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.samples {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.samples :deep(.el-button) {
  width: 100%;
  margin-left: 0;
}

.empty-answer {
  margin-top: 16px;
  padding: 14px 16px;
  background: #f7f1e6;
  border: 1px solid var(--zw-line);
  line-height: 1.7;
}

.empty-answer p {
  margin: 0 0 8px;
}

.empty-answer p:last-child {
  margin-bottom: 0;
}

.empty-q {
  font-weight: 700;
}

.widget-alert {
  margin-top: 16px;
}

@media (max-width: 640px) {
  .custom-ask {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
