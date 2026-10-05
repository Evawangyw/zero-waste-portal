<script setup lang="ts">
// 首页（T05）：第一屏 = AI 提问入口（主）+ 搜索框（次，跳书架）+ 3 个示例问题。
//
// 挂件按官方「安全模式」接（见 composables/useWidget.ts），本页面不自己写问答 UI。
// 页面只做两件事：把用户的问题交给挂件（openWithQuery）、把关键词交给书架（路由 query）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { SAMPLE_QUESTIONS } from '../constants'
import { fetchShelfTotal } from '../api/docs'
import {
  askWidget,
  flushPendingQuery,
  mountWidget,
  widgetError,
  widgetQueuedAsks,
  widgetStatus,
} from '../composables/useWidget'
import { currentUser } from '../composables/useAuth'

const router = useRouter()

const keyword = ref('')
const customQuestion = ref('')

/**
 * 书架资料总条数（P2-5：原来「共 42 条」是硬编码，数据一变就与实际失配）。
 * 读接口；读不到就退回 null，模板不显示数字而不是显示一个错的数字。
 */
const shelfTotal = ref<number | null>(null)

onMounted(() => {
  // 官方 loader 就绪后放行排队中的问题（用户在脚本到达前点了示例问题的场景）
  window.setTimeout(() => {
    flushPendingQuery()
  }, 800)
  void mountWidget()
  void loadShelfTotal()
})

async function loadShelfTotal(): Promise<void> {
  try {
    shelfTotal.value = await fetchShelfTotal()
  } catch {
    // 统计条数只是锦上添花，取不到就不显示数字，不打断页面
    shelfTotal.value = null
  }
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

/** 搜索框（次要入口）-> 跳书架并带上关键词 */
function onSearch(): void {
  const text = keyword.value.trim()
  void router.push(text === '' ? { path: '/shelf' } : { path: '/shelf', query: { q: text } })
}
</script>

<template>
  <div class="home">
    <el-card class="ask-card" shadow="never">
      <h1 class="title">问点什么</h1>
      <p class="subtitle">
        下面是 AI 助手（右下角 💬 挂件）。它只依据本知识库里的零废弃政策与实践资料生成答案，
        资料里没有的它会直说没有，不会编。
      </p>

      <!-- 自定义提问 -->
      <div class="custom-ask">
        <el-input
          v-model="customQuestion"
          placeholder="例如：社区厨余堆肥活动怎么设计？"
          clearable
          @keyup.enter="onCustomAsk"
        />
        <el-button type="primary" @click="onCustomAsk">向 AI 提问</el-button>
      </div>

      <!-- 示例问题（PRD 两类场景 + 政策原文式） -->
      <div class="samples">
        <span class="samples-label">试试这些问题：</span>
        <el-space wrap>
          <el-button
            v-for="item in SAMPLE_QUESTIONS"
            :key="item.text"
            plain
            size="small"
            @click="onSampleQuestion(item.text)"
          >
            {{ item.scene }}：{{ item.text }}
          </el-button>
        </el-space>
      </div>

      <!-- 挂件状态提示（失败时降级提示，不让整页挂掉） -->
      <el-alert
        v-if="widgetStatus === 'error'"
        class="widget-alert"
        type="warning"
        show-icon
        :closable="false"
        title="AI 暂时不可用，请稍后再试"
        :description="`${widgetError}；你也可以直接用下面的搜索框去书架找资料。`"
      />
      <p v-else-if="widgetStatus === 'idle' || widgetStatus === 'loading'" class="widget-loading">
        AI 助手加载中…（若长时间未出现，请检查右下角是否被浏览器扩展遮挡）
      </p>
      <p v-else class="widget-ok">
        AI 助手已就绪，点右下角 💬 打开，或直接点上面的示例问题。
        <template v-if="widgetQueuedAsks > 0">
          （已有 {{ widgetQueuedAsks }} 个问题在排队，上一条答完会自动发出）
        </template>
      </p>

      <p v-if="currentUser" class="widget-user">
        已登录（{{ currentUser.name }}），提问会带上你的身份信息；未登录也可以问。
      </p>
    </el-card>

    <el-card class="search-card" shadow="never">
      <h2 class="subtitle-title">或者，自己翻书架</h2>
      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="按文件名/标题搜索，如：垃圾分类"
          clearable
          @keyup.enter="onSearch"
        />
        <el-button @click="onSearch">去书架搜</el-button>
      </div>
      <p class="tips">
        书架支持按年份、发布机构、知识类型、主题多维筛选，共
        <template v-if="shelfTotal !== null">{{ shelfTotal }} 条</template>
        <template v-else>若干条</template>
        零废弃政策与实践资料。
      </p>
    </el-card>

    <el-row class="entries" :gutter="16">
      <el-col :xs="24" :sm="12" :lg="8">
        <el-card shadow="hover" class="entry-card">
          <template #header><strong>资料书架</strong></template>
          <p>
            <template v-if="shelfTotal !== null">{{ shelfTotal }} 条</template>
            <template v-else>若干条</template>
            政策与实践资料，按四个维度筛选，带在线预览与下载。
          </p>
          <router-link to="/shelf">
            <el-button type="primary" plain size="small">进入书架</el-button>
          </router-link>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :lg="8">
        <el-card shadow="hover" class="entry-card">
          <template #header><strong>AI 助手</strong></template>
          <p>免登录提问，答案基于库内资料生成；答不出来会明说，不猜。</p>
          <el-button size="small" @click="onSampleQuestion(SAMPLE_QUESTIONS[0].text)">
            问一个试试
          </el-button>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :lg="8">
        <el-card shadow="hover" class="entry-card">
          <template #header><strong>注册账号</strong></template>
          <p>注册后可下载资料，提问时自动带上你的机构与关注议题。</p>
          <router-link to="/auth">
            <el-button size="small">去注册</el-button>
          </router-link>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="org-card" shadow="never">
      <div class="org-row">
        <div>
          <h2 class="subtitle-title">安徽省六尺巷慈善基金会</h2>
          <p class="tips">
            本知识库关注的零废弃议题，也是这家基金会官网的工作专栏之一。可以先看机构愿景、工作领域和公开信息。
          </p>
        </div>
        <router-link to="/foundation">
          <el-button type="primary" plain>查看机构介绍</el-button>
        </router-link>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.title {
  margin: 0 0 8px;
  font-size: 26px;
}

.subtitle,
.tips {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}

.subtitle-title {
  margin: 0 0 12px;
  font-size: 18px;
}

.custom-ask {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.samples {
  margin-bottom: 12px;
}

.samples-label {
  margin-right: 8px;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.widget-alert {
  margin-top: 8px;
}

.widget-loading,
.widget-ok,
.widget-user {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.search-row {
  display: flex;
  gap: 12px;
}

.entry-card {
  height: 100%;
}

.entry-card p {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}

.org-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.org-card .tips {
  margin: 0;
}

@media (max-width: 640px) {
  .org-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
