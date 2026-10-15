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
import AnswerMarkdown from '../components/AnswerMarkdown.vue'
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
  const parsed = readExtractiveAnswer(content)
  if (parsed.sources.length > 0) return parsed.body
  return content
    .replace(/\n*参考来源[\s\S]*$/, '')
    .replace(/\n*@@sources@@[\s\S]*$/, '')
    .trimEnd()
}

function sourceByIndex(content: string, index: number): AskSource | undefined {
  return answerSources(content).find((source) => source.index === index)
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
  <div v-if="isLoggedIn" class="assistant">
    <aside class="sidebar">
      <button type="button" class="new-chat" :disabled="sending || windowBusy" @click="onNewConversation">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        新对话
      </button>
      <p class="history-label">历史对话</p>
      <div class="history-list">
        <p v-if="conversations.length === 0" class="history-empty">还没有历史对话</p>
        <button
          v-for="item in conversations"
          :key="item.id"
          type="button"
          class="history"
          :class="{ active: item.id === conversationId }"
          :disabled="sending || windowBusy"
          @click="onSwitchConversation(item.id)"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M5 6h14v9H8l-3 3V6z" fill="none" stroke="currentColor" stroke-width="1.6" />
          </svg>
          <span>{{ conversationLabel(item) }}</span>
        </button>
      </div>
      <button
        type="button"
        class="clear-chat"
        :disabled="sending || windowBusy || messages.length === 0"
        @click="onClearConversation"
      >
        清空当前对话
      </button>
      <div class="sidebar-tip">
        <b>回答来自原文</b>
        <p>每条结论都标出来源。点开来源，可以打开对应资料。</p>
      </div>
    </aside>

    <section class="chat-column">
      <div class="mobile-bar">
        <button type="button" class="new-chat" :disabled="sending || windowBusy" @click="onNewConversation">
          新对话
        </button>
        <button
          type="button"
          class="clear-chat"
          :disabled="sending || windowBusy || messages.length === 0"
          @click="onClearConversation"
        >
          清空
        </button>
      </div>
      <div v-if="conversations.length > 0" class="mobile-history">
        <button
          v-for="item in conversations"
          :key="item.id"
          type="button"
          class="history"
          :class="{ active: item.id === conversationId }"
          :disabled="sending || windowBusy"
          @click="onSwitchConversation(item.id)"
        >
          {{ conversationLabel(item) }}
        </button>
      </div>

      <div ref="transcript" class="chat-main">
        <div v-if="messages.length === 0" class="chat-welcome">
          <div class="ai-orb" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path
                d="M12 20c0-5.2 1.6-8 7-9.6C17.6 16 14.8 20 12 20Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
              <path
                d="M12 20C12 14.8 10.4 12 5 10.4 6.4 16 9.2 20 12 20Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
              <path d="M12 20V11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </div>
          <p class="kicker">零废弃知识库</p>
          <h1>向知识库提问</h1>
          <p>汇集政策、研究、标准与一线案例。回答从原文抽取，并附上可以打开的来源。</p>
          <div class="quick-grid">
            <button
              v-for="item in SAMPLE_QUESTIONS"
              :key="item.text"
              type="button"
              :disabled="sending"
              @click="onSampleQuestion(item.text)"
            >
              <span>{{ item.scene }}</span>
              {{ item.text }}
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div v-else class="conversation">
          <template v-for="line in messages" :key="line.id">
            <div v-if="line.role === 'user'" class="user-message">
              <span>{{ line.content }}</span>
            </div>
            <article v-else class="answer-block">
              <div class="ai-avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path
                    d="M12 19c0-4.4 1.4-6.8 6-8.2C16.6 15.2 14.2 19 12 19Z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M12 19C12 14.6 10.6 12.2 6 10.8 7.4 15.2 9.8 19 12 19Z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linejoin="round"
                  />
                  <path d="M12 19v-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </div>
              <div class="answer-content">
                <div
                  v-if="line.thinking !== '' || (sending && line.id === liveId && answerBody(line.content) === '')"
                  class="thinking"
                >
                  <i /><i /><i />
                  <span>{{ line.thinking === '' ? '正在从原文里查找…' : line.thinking }}</span>
                </div>
                <AnswerMarkdown
                  v-if="answerBody(line.content).trim() !== ''"
                  :body="answerBody(line.content)"
                  @cite="openSource(sourceByIndex(line.content, $event)?.docId ?? '')"
                />
                <div v-if="answerSources(line.content).length > 0" class="sources">
                  <h3>参考来源</h3>
                  <button
                    v-for="source in answerSources(line.content)"
                    :key="source.index"
                    type="button"
                    class="citation"
                    @click="openSource(source.docId)"
                  >
                    <span>{{ source.index }}</span>
                    <div>
                      <b>{{ source.title }}</b>
                      <small v-if="sourceMeta(source) !== ''">{{ sourceMeta(source) }}</small>
                    </div>
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </article>
          </template>
        </div>
      </div>

      <form class="composer-wrap" @submit.prevent="onCustomAsk">
        <div class="composer">
          <textarea
            v-model="customQuestion"
            rows="1"
            placeholder="例如：社区厨余堆肥活动怎么设计？"
            :disabled="sending"
            @keydown.enter.exact.prevent="onCustomAsk"
          />
          <button type="submit" :disabled="sending || customQuestion.trim() === ''" aria-label="发送">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        <small>回答依据库内原文，具体执行以官方文件为准</small>
      </form>
    </section>
  </div>
</template>

<style scoped>
.assistant {
  --ask-green: #285c49;
  --ask-deep: #194436;
  --ask-paper: #f7f5ee;
  --ask-sidebar: #efeee5;
  --ask-ink: #24302a;
  --ask-muted: #6f7772;
  --ask-line: rgba(41, 68, 56, 0.14);
  --ask-rust: #be5b32;
  display: grid;
  grid-template-columns: 268px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--ask-paper);
  color: var(--ask-ink);
}

.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 22px 16px;
  border-right: 1px solid var(--ask-line);
  background: var(--ask-sidebar);
}

.new-chat,
.clear-chat,
.history,
.quick-grid button,
.citation,
.composer button {
  font: inherit;
  cursor: pointer;
}

.new-chat:disabled,
.clear-chat:disabled,
.history:disabled,
.quick-grid button:disabled,
.composer button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.new-chat {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 11px;
  border: 1px solid var(--ask-green);
  border-radius: 10px;
  background: transparent;
  color: var(--ask-green);
  font-weight: 700;
}

.new-chat:hover:not(:disabled) {
  background: #fff;
}

.history-label {
  margin: 26px 8px 8px;
  color: #7d9186;
  font-size: 11px;
  letter-spacing: 0.14em;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
}

.history-empty {
  margin: 8px 10px;
  color: var(--ask-muted);
  font-size: 12px;
}

.history {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #4d6358;
  font-size: 13px;
  text-align: left;
}

.history span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history.active,
.history:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.72);
  color: var(--ask-deep);
}

.clear-chat {
  margin-top: 12px;
  padding: 8px;
  border: 0;
  background: transparent;
  color: var(--ask-green);
  font-size: 12px;
  font-weight: 700;
}

.sidebar-tip {
  margin-top: auto;
  padding: 16px;
  border: 1px solid var(--ask-line);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.55);
  color: var(--ask-green);
}

.sidebar-tip b {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
}

.sidebar-tip p {
  margin: 0;
  color: var(--ask-muted);
  font-size: 12px;
  line-height: 1.6;
}

.chat-column {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.mobile-bar,
.mobile-history {
  display: none;
}

.chat-main {
  height: 100%;
  overflow-y: auto;
  padding-bottom: 128px;
}

.chat-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 820px;
  min-height: calc(100% - 20px);
  margin: 0 auto;
  padding: 72px 36px 40px;
  text-align: center;
  box-sizing: border-box;
}

.ai-orb,
.ai-avatar {
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--ask-green);
}

.ai-orb {
  width: 66px;
  height: 66px;
  margin-bottom: 18px;
  border-radius: 22px 22px 22px 8px;
  box-shadow: 0 14px 30px rgba(40, 92, 73, 0.23);
}

.chat-welcome .kicker {
  margin: 0;
  color: var(--ask-rust);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.chat-welcome h1 {
  margin: 10px 0;
  color: var(--ask-deep);
  font-family: var(--serif);
  font-size: 40px;
  font-weight: 700;
}

.chat-welcome > p {
  max-width: 520px;
  margin: 0;
  color: var(--ask-muted);
  line-height: 1.8;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  margin-top: 32px;
}

.quick-grid button {
  position: relative;
  min-height: 116px;
  padding: 18px 36px 18px 18px;
  border: 1px solid var(--ask-line);
  border-radius: 14px;
  background: var(--paper);
  color: var(--ask-ink);
  line-height: 1.65;
  text-align: left;
  transition: 0.2s ease;
}

.quick-grid button:hover:not(:disabled) {
  border-color: rgba(40, 92, 73, 0.35);
  box-shadow: 0 12px 30px rgba(40, 60, 50, 0.09);
  transform: translateY(-3px);
}

.quick-grid button span {
  display: block;
  margin-bottom: 8px;
  color: var(--ask-rust);
  font-weight: 800;
  letter-spacing: 0.12em;
}

.quick-grid button svg {
  position: absolute;
  right: 14px;
  bottom: 16px;
  color: var(--ask-green);
}

.conversation {
  max-width: 840px;
  margin: 0 auto;
  padding: 42px 36px 20px;
}

.user-message {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 28px;
}

.user-message span {
  max-width: 72%;
  padding: 13px 16px;
  border-radius: 16px 4px 16px 16px;
  background: #e5e8dd;
  font-size: 14px;
  line-height: 1.7;
}

.answer-block {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 34px;
}

.ai-avatar {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 11px 11px 11px 4px;
}

.answer-content {
  flex: 1;
  min-width: 0;
}

.thinking {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin-bottom: 12px;
  color: var(--ask-muted);
  font-size: 13px;
  line-height: 1.6;
}

.thinking i {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--ask-green);
  animation: pulse 1s infinite;
}

.thinking i:nth-of-type(2) {
  animation-delay: 0.15s;
}

.thinking i:nth-of-type(3) {
  animation-delay: 0.3s;
}

.thinking span {
  white-space: pre-wrap;
}

.sources {
  margin-top: 8px;
  padding: 16px 16px 6px;
  border-radius: 13px;
  background: #efeee5;
}

.sources h3 {
  margin: 0 0 4px;
  color: #5d7266;
  font-size: 12px;
  font-weight: 700;
}

.citation {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 16px;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 12px 0;
  border: 0;
  border-top: 1px solid var(--ask-line);
  background: transparent;
  text-align: left;
}

.citation:first-of-type {
  border-top: 0;
}

.citation > span {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 6px;
  background: var(--ask-green);
  color: #fff;
  font-size: 11px;
}

.citation b,
.citation small {
  display: block;
}

.citation b {
  color: var(--ask-ink);
  font-size: 13px;
  line-height: 1.5;
}

.citation small {
  margin-top: 3px;
  color: #7b8d83;
  font-size: 12px;
}

.citation svg {
  color: var(--ask-green);
}

.composer-wrap {
  position: absolute;
  left: 50%;
  bottom: 16px;
  z-index: 5;
  width: min(740px, calc(100% - 40px));
  transform: translateX(-50%);
  text-align: center;
}

.composer {
  display: flex;
  align-items: flex-end;
  padding: 8px 8px 8px 16px;
  border: 1px solid rgba(40, 92, 73, 0.22);
  border-radius: 16px;
  background: rgba(255, 253, 247, 0.95);
  box-shadow: 0 15px 45px rgba(43, 59, 50, 0.14);
}

.composer textarea {
  flex: 1;
  min-height: 26px;
  max-height: 90px;
  padding: 8px 0;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: var(--ask-ink);
  font: inherit;
  line-height: 1.5;
}

.composer button {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 0;
  border-radius: 11px;
  background: var(--ask-green);
  color: #fff;
}

.composer-wrap small {
  display: block;
  margin-top: 8px;
  color: #8aa093;
  font-size: 11px;
}

@keyframes pulse {
  50% {
    opacity: 0.25;
    transform: translateY(-3px);
  }
}

@media (max-width: 860px) {
  .assistant {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .mobile-bar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px 0;
  }

  .mobile-bar .new-chat,
  .mobile-bar .clear-chat {
    width: auto;
    padding: 8px 12px;
  }

  .mobile-history {
    display: flex;
    gap: 8px;
    padding: 10px 16px 0;
    overflow-x: auto;
  }

  .mobile-history .history {
    flex: none;
    width: auto;
    max-width: 180px;
    background: rgba(255, 255, 255, 0.7);
  }

  .chat-welcome {
    padding: 36px 18px 24px;
  }

  .chat-welcome h1 {
    font-size: 30px;
  }

  .quick-grid {
    grid-template-columns: 1fr;
  }

  .conversation {
    padding: 28px 16px 12px;
  }
}
</style>
