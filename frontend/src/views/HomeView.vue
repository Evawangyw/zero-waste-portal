<script setup lang="ts">
// 登录后的首页只保留向知识库提问。问题交给官方挂件，不在本页自写问答窗口。
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { SAMPLE_QUESTIONS } from '../constants'
import {
  askWidget,
  flushPendingQuery,
  mountWidget,
  widgetError,
  widgetStatus,
} from '../composables/useWidget'
import { isLoggedIn } from '../composables/useAuth'
import FoundationView from './FoundationView.vue'

const customQuestion = ref('')

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
}

/** 点示例问题 -> 交给挂件自动发送 */
function onSampleQuestion(text: string): void {
  askWidget(text)
}

/** 自己写个问题 -> 也走挂件（与示例问题同一条通路，不另造 UI） */
function onCustomAsk(): void {
  const text = customQuestion.value.trim()
  if (text === '') {
    ElMessage.warning('请先输入你的问题')
    return
  }
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
