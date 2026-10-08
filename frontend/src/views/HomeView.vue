<script setup lang="ts">
// 登录后的首页就是一轮一轮的对话。回答直接写在本页，并按账号保存历史。
import { nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { SAMPLE_QUESTIONS } from '../constants'
import { fetchChatHistory, saveChatTurn, streamAsk } from '../api/ask'
import { fetchShelfTotal } from '../api/docs'
import { ApiError } from '../api/http'
import type { ChatMessage } from '../api/types'
import { authToken, isLoggedIn } from '../composables/useAuth'
import FoundationView from './FoundationView.vue'

interface TranscriptLine {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const customQuestion = ref('')
const libraryEmpty = ref(false)
const sending = ref(false)
const messages = ref<TranscriptLine[]>([])
const transcript = ref<HTMLElement | null>(null)

onMounted(() => {
  if (!isLoggedIn.value) return
  startMemberHome()
})

watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) startMemberHome()
  else messages.value = []
})

function startMemberHome(): void {
  void loadLibraryState()
  void loadHistory()
}

async function loadLibraryState(): Promise<void> {
  try {
    libraryEmpty.value = (await fetchShelfTotal()) === 0
  } catch {
    libraryEmpty.value = false
  }
}

async function loadHistory(): Promise<void> {
  const token = authToken()
  if (token === null) return
  try {
    const response = await fetchChatHistory(token)
    messages.value = response.messages.map(toLine)
    await scrollToEnd()
  } catch (err) {
    ElMessage.warning(err instanceof Error ? err.message : '历史对话加载失败')
  }
}

function onSampleQuestion(text: string): void {
  void submitQuestion(text)
}

function onCustomAsk(): void {
  void submitQuestion(customQuestion.value)
}

async function submitQuestion(raw: string): Promise<void> {
  const text = raw.trim()
  if (text === '') {
    ElMessage.warning('请先输入你的问题')
    return
  }
  if (sending.value) return
  const token = authToken()
  if (token === null) {
    ElMessage.warning('请先登录')
    return
  }
  if (libraryEmpty.value) {
    messages.value = [
      ...messages.value,
      { id: localId(), role: 'user', content: text },
      { id: localId(), role: 'assistant', content: '库内暂未收录正式资料，所以不能回答。' },
    ]
    customQuestion.value = ''
    await scrollToEnd()
    return
  }

  customQuestion.value = ''
  const assistantId = localId()
  messages.value = [
    ...messages.value,
    { id: localId(), role: 'user', content: text },
    { id: assistantId, role: 'assistant', content: '' },
  ]
  sending.value = true
  await scrollToEnd()
  let persisted = false
  try {
    await streamAsk(token, text, (chunk) => {
      appendAnswer(assistantId, chunk)
    })
    const answer = readAnswer(assistantId)
    const saved = answer === '' ? '没有收到回答，请再试一次。' : answer
    if (answer === '') replaceAnswer(assistantId, saved)
    await saveChatTurn(token, text, saved)
    persisted = true
  } catch (err) {
    const message = err instanceof ApiError ? err.message : '回答中断，请再试一次'
    const current = readAnswer(assistantId)
    const shown = current === '' ? message : `${current}\n\n${message}`
    replaceAnswer(assistantId, shown)
    if (!persisted) {
      try {
        await saveChatTurn(token, text, shown)
      } catch {
        // 这一轮先留在页面上；保存失败不盖住回答本身
      }
    }
    ElMessage.error(message)
  } finally {
    sending.value = false
    await scrollToEnd()
  }
}

function appendAnswer(id: string, chunk: string): void {
  messages.value = messages.value.map((line) =>
    line.id === id ? { ...line, content: line.content + chunk } : line,
  )
  void scrollToEnd()
}

function replaceAnswer(id: string, content: string): void {
  messages.value = messages.value.map((line) => (line.id === id ? { ...line, content } : line))
}

function readAnswer(id: string): string {
  return messages.value.find((line) => line.id === id)?.content ?? ''
}

function toLine(message: ChatMessage): TranscriptLine {
  return { id: message.id, role: message.role, content: message.content }
}

function localId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function scrollToEnd(): Promise<void> {
  await nextTick()
  const node = transcript.value
  if (node !== null) node.scrollTop = node.scrollHeight
}
</script>

<template>
  <FoundationView v-if="!isLoggedIn" />
  <div v-else class="home">
    <el-card class="ask-card" shadow="never">
      <template #header>向知识库提问</template>

      <div ref="transcript" class="transcript">
        <p v-if="messages.length === 0" class="empty-hint">
          直接输入问题，回答会留在这个页面上。刷新后仍能看到你自己的历史对话。
        </p>
        <div
          v-for="line in messages"
          :key="line.id"
          class="turn"
          :class="line.role === 'user' ? 'turn-user' : 'turn-assistant'"
        >
          <p class="role">{{ line.role === 'user' ? '我' : '助手' }}</p>
          <p class="bubble">{{ line.content === '' ? '正在回答…' : line.content }}</p>
        </div>
      </div>

      <div v-if="messages.length === 0" class="samples">
        <el-button
          v-for="item in SAMPLE_QUESTIONS"
          :key="item.text"
          plain
          :disabled="sending"
          @click="onSampleQuestion(item.text)"
        >
          {{ item.text }}
        </el-button>
      </div>

      <div class="custom-ask">
        <el-input
          v-model="customQuestion"
          placeholder="例如：社区厨余堆肥活动怎么设计？"
          clearable
          :disabled="sending"
          @keyup.enter="onCustomAsk"
        />
        <el-button type="primary" :loading="sending" @click="onCustomAsk">发送</el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
}

.transcript {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 220px;
  max-height: min(62vh, 640px);
  overflow-y: auto;
  margin-bottom: 16px;
  padding-right: 4px;
}

.empty-hint {
  margin: 0;
  color: #6b7280;
  line-height: 1.7;
}

.turn {
  display: flex;
  flex-direction: column;
  max-width: 85%;
}

.turn-user {
  align-self: flex-end;
  align-items: flex-end;
}

.turn-assistant {
  align-self: flex-start;
  align-items: flex-start;
}

.role {
  margin: 0 0 4px;
  font-size: 12px;
  color: #6b7280;
}

.bubble {
  margin: 0;
  padding: 10px 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--zw-line);
}

.turn-user .bubble {
  background: #1f7a4d;
  color: #fff;
  border-color: #1f7a4d;
}

.turn-assistant .bubble {
  background: #f7f7f5;
}

.custom-ask {
  display: flex;
  gap: 12px;
}

.samples {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 16px;
}

.samples :deep(.el-button) {
  width: 100%;
  margin-left: 0;
}

@media (max-width: 640px) {
  .custom-ask {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
