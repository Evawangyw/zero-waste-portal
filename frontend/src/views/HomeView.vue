<script setup lang="ts">
// 登录后的首页就是一轮一轮的对话。回答直接写在本页，并按账号保存历史。
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { SAMPLE_QUESTIONS } from '../constants'
import {
  clearChatConversation,
  fetchChatHistory,
  readExtractiveAnswer,
  saveChatTurn,
  startChatConversation,
  streamAsk,
} from '../api/ask'
import type { AskSource } from '../api/ask'
import { fetchShelfTotal } from '../api/docs'
import { ApiError } from '../api/http'
import type { ChatConversationSummary, ChatHistoryResponse, ChatMessage } from '../api/types'
import { authToken, isLoggedIn } from '../composables/useAuth'

interface TranscriptLine {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking: string
}

const router = useRouter()
const customQuestion = ref('')
const libraryEmpty = ref(false)
const sending = ref(false)
const windowBusy = ref(false)
const liveId = ref('')
const conversationId = ref('')
const conversations = ref<ChatConversationSummary[]>([])
const messages = ref<TranscriptLine[]>([])
const transcript = ref<HTMLElement | null>(null)

onMounted(() => {
  if (!isLoggedIn.value) return
  startMemberHome()
})

watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) startMemberHome()
  else {
    messages.value = []
    conversations.value = []
    conversationId.value = ''
  }
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

async function loadHistory(nextId?: string): Promise<void> {
  const token = authToken()
  if (token === null) return
  try {
    applyWindow(await fetchChatHistory(token, nextId))
    await scrollToEnd()
  } catch (err) {
    ElMessage.warning(err instanceof Error ? err.message : '历史对话加载失败')
  }
}

function onSwitchConversation(value: string): void {
  if (value === conversationId.value || sending.value || windowBusy.value) return
  void loadHistory(value)
}

async function onNewConversation(): Promise<void> {
  if (sending.value || windowBusy.value) return
  if (messages.value.length === 0) {
    ElMessage.info('当前已经是新对话')
    return
  }
  const token = authToken()
  if (token === null) return
  windowBusy.value = true
  try {
    applyWindow(await startChatConversation(token))
    customQuestion.value = ''
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '新对话没有打开')
  } finally {
    windowBusy.value = false
  }
}

async function onClearConversation(): Promise<void> {
  if (sending.value || windowBusy.value || messages.value.length === 0) return
  const token = authToken()
  if (token === null || conversationId.value === '') return
  try {
    await ElMessageBox.confirm('清空后，当前这一轮的提问会被删掉。其他对话还在。', '清空当前对话', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  windowBusy.value = true
  try {
    applyWindow(await clearChatConversation(token, conversationId.value))
    customQuestion.value = ''
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '清空失败')
  } finally {
    windowBusy.value = false
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
      { id: localId(), role: 'user', content: text, thinking: '' },
      {
        id: localId(),
        role: 'assistant',
        content: '库内暂未收录正式资料，所以不能回答。',
        thinking: '',
      },
    ]
    customQuestion.value = ''
    await scrollToEnd()
    return
  }

  customQuestion.value = ''
  const assistantId = localId()
  liveId.value = assistantId
  messages.value = [
    ...messages.value,
    { id: localId(), role: 'user', content: text, thinking: '' },
    { id: assistantId, role: 'assistant', content: '', thinking: '' },
  ]
  sending.value = true
  await scrollToEnd()
  let persisted = false
  try {
    await streamAsk(
      token,
      text,
      (chunk) => {
        appendAnswer(assistantId, chunk)
      },
      (chunk) => {
        appendThinking(assistantId, chunk)
      },
    )
    const answer = readAnswer(assistantId)
    const saved = answer === '' ? '没有收到回答，请再试一次。' : answer
    if (answer === '') replaceAnswer(assistantId, saved)
    applyWindow(await saveChatTurn(token, text, saved, readThinking(assistantId), activeConversationId()))
    persisted = true
  } catch (err) {
    const message = err instanceof ApiError ? err.message : '回答中断，请再试一次'
    const current = readAnswer(assistantId)
    const shown = current === '' ? message : `${current}\n\n${message}`
    replaceAnswer(assistantId, shown)
    if (!persisted) {
      try {
        applyWindow(
          await saveChatTurn(token, text, shown, readThinking(assistantId), activeConversationId()),
        )
      } catch {
        // 这一轮先留在页面上；保存失败不盖住回答本身
      }
    }
    ElMessage.error(message)
  } finally {
    sending.value = false
    liveId.value = ''
    await scrollToEnd()
  }
}

function appendAnswer(id: string, chunk: string): void {
  messages.value = messages.value.map((line) =>
    line.id === id ? { ...line, content: line.content + chunk } : line,
  )
  void scrollToEnd()
}

function appendThinking(id: string, chunk: string): void {
  messages.value = messages.value.map((line) =>
    line.id === id ? { ...line, thinking: line.thinking + chunk } : line,
  )
  void scrollToEnd()
}

function replaceAnswer(id: string, content: string): void {
  messages.value = messages.value.map((line) => (line.id === id ? { ...line, content } : line))
}

function readAnswer(id: string): string {
  return messages.value.find((line) => line.id === id)?.content ?? ''
}

function readThinking(id: string): string {
  return messages.value.find((line) => line.id === id)?.thinking ?? ''
}

function applyWindow(window: ChatHistoryResponse): void {
  conversationId.value = window.conversation.id
  conversations.value = [...window.conversations]
  messages.value = window.messages.map(toLine)
}

function activeConversationId(): string | undefined {
  return conversationId.value === '' ? undefined : conversationId.value
}

function conversationLabel(item: ChatConversationSummary): string {
  const sameTitle = conversations.value.filter((row) => row.title === item.title).length
  if (sameTitle < 2) return item.title
  const time = new Date(item.updatedAt)
  if (Number.isNaN(time.getTime())) return item.title
  const month = time.getMonth() + 1
  const day = time.getDate()
  const hour = time.getHours().toString().padStart(2, '0')
  const minute = time.getMinutes().toString().padStart(2, '0')
  return `${item.title} · ${month}/${day} ${hour}:${minute}`
}

function toLine(message: ChatMessage): TranscriptLine {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    thinking: message.thinking ?? '',
  }
}

function answerBody(content: string): string {
  return readExtractiveAnswer(content).body
}

function answerSources(content: string): readonly AskSource[] {
  return readExtractiveAnswer(content).sources
}

function sourceMeta(source: AskSource): string {
  return [source.docType, source.organization, source.year].filter((part) => part !== '').join(' · ')
}

function openSource(docId: string): void {
  if (docId === '') return
  void router.push(`/doc/${docId}`)
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
  <div v-if="isLoggedIn" class="home">
    <el-card class="ask-card" shadow="never">
      <template #header>
        <div class="ask-head">
          <span>向知识库提问</span>
          <div class="ask-actions">
            <el-select
              v-if="conversations.length > 1 || messages.length > 0"
              :model-value="conversationId"
              size="small"
              class="conversation-select"
              :disabled="sending || windowBusy"
              @change="onSwitchConversation"
            >
              <el-option
                v-for="item in conversations"
                :key="item.id"
                :label="conversationLabel(item)"
                :value="item.id"
              />
            </el-select>
            <el-button size="small" :disabled="sending || windowBusy" @click="onNewConversation">
              新对话
            </el-button>
            <el-button
              size="small"
              :disabled="sending || windowBusy || messages.length === 0"
              @click="onClearConversation"
            >
              清空
            </el-button>
          </div>
        </div>
      </template>

      <div ref="transcript" class="transcript">
        <p v-if="messages.length === 0" class="empty-hint">
          直接输入问题。新对话会另开一轮，以前的记录可以在上面切回去。清空只删掉当前这一轮。
        </p>
        <div
          v-for="line in messages"
          :key="line.id"
          class="turn"
          :class="line.role === 'user' ? 'turn-user' : 'turn-assistant'"
        >
          <p class="role">{{ line.role === 'user' ? '我' : '助手' }}</p>
          <div
            v-if="line.role === 'assistant' && (line.thinking !== '' || (sending && line.id === liveId))"
            class="thinking"
          >
            <p class="thinking-label">思考过程</p>
            <p class="thinking-body">{{ line.thinking === '' ? '正在思考…' : line.thinking }}</p>
          </div>
          <p v-if="answerBody(line.content) !== ''" class="bubble">{{ answerBody(line.content) }}</p>
          <ul v-if="line.role === 'assistant' && answerSources(line.content).length > 0" class="sources">
            <li v-for="source in answerSources(line.content)" :key="source.index">
              <button type="button" class="source-link" @click="openSource(source.docId)">
                [[{{ source.index }}]] {{ source.title }}
              </button>
              <span v-if="sourceMeta(source) !== ''" class="source-meta">{{ sourceMeta(source) }}</span>
            </li>
          </ul>
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

.ask-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ask-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ask-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.conversation-select {
  width: 180px;
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

.sources {
  width: 100%;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.sources li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid var(--zw-line);
}

.source-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: #017c40;
  font: inherit;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.source-meta {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.thinking {
  width: 100%;
  margin-bottom: 8px;
  padding: 8px 10px;
  background: #f3faf6;
  border: 1px solid #d7eadf;
  border-left: 3px solid #017c40;
}

.thinking-label {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: #017c40;
}

.thinking-body {
  margin: 0;
  max-height: 180px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: #3d4a42;
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
  .ask-head,
  .ask-actions,
  .custom-ask {
    flex-direction: column;
    align-items: stretch;
  }

  .conversation-select {
    width: 100%;
  }
}
</style>
