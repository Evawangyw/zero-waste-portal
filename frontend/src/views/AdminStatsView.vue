<script setup lang="ts">
// 管理统计最简页（T08lite）：给管理员看的「先看效果」版看板。
//
// 契约（docs/task-cards/T07-契约.md §4）：
//   GET /api/admin/stats/summary  —— 五块数据全部来自这一个接口的现成字段，零后端改动。
//
// 三条边界（卡片原文）：
//  - 不引图表库：全部用 el-table / el-card / el-descriptions 渲染；
//  - 不做导出、不做筛选（是节后 T08 正式版的活）；
//  - 数字一个都不换算口径：PV/UV/无答案率的定义全在后端 track.stats.ts，
//    页面只负责把原值显示出来，这样「页面 vs curl summary」能逐条对上（验收①）。
//
// 权限：本页**不在路由层放守卫**——卡片要求非管理员访问时「看到提示页」而不是被重定向，
// 所以判定放在视图内：校验中 → 未登录 → 非管理员，三态各自给对应提示，绝不白屏。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchStatsSummary } from '../api/admin'
import { ApiError } from '../api/http'
import type { StatsSummaryResponse } from '../api/types'
import { ADMIN_STATS_REFRESH_MS, TRACK_EVENT_LABELS } from '../constants'
import { authToken, currentUser, isLoggedIn, restoreAuth } from '../composables/useAuth'

const router = useRouter()

// ---------------------------------------------------------------- 权限三态

/** 登录态是否已校验完（false = 还在拉 /me，此刻不能下"非管理员"的结论） */
const authChecked = ref(false)
/** 登录态校验失败但 token 还在（后端 /me 不可用）：这时既不能说他是管理员，也不能说不是 */
const authUnverified = ref(false)

const isAdmin = computed(() => currentUser.value?.isAdmin === true)

/** 是否该展示五块数据区（只有管理员且登录态已确认） */
const showPanel = computed(() => authChecked.value && isAdmin.value && !authUnverified.value)

// ---------------------------------------------------------------- 数据

const summary = ref<StatsSummaryResponse | null>(null)
const loading = ref(false)
const loadError = ref('')

/** 事件分布表的行（key/label 来自 constants，值来自 summary.events，缺项补 0） */
const eventRows = computed(() =>
  TRACK_EVENT_LABELS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count: summary.value?.events[entry.key] ?? 0,
  })),
)

/** 无答案率：后端给的是 0~1 的小数（= noAnswer / judged），这里只做展示换算 */
const noAnswerRateText = computed(() => percent(summary.value?.asks.noAnswerRate ?? 0))

/**
 * 下载对账（QA-01 P2-9）。
 *
 * 原实现在两者不等时直接下结论「有接口被直连」—— QA-01 实测证明这是**没有证据的归因**：
 * 两个计数器在测试窗口内是同步 +5 的，差额来自历史遗留（基线就 7 vs 2）。
 * 页面不该替管理员下结论，这里只陈述两个事实：差额是多少、以及差额可能来自哪里。
 */
const downloadGap = computed(() => {
  const downloads = summary.value?.downloads
  if (downloads === undefined) return null
  return downloads.logRows - downloads.events
})

// ---------------------------------------------------------------- 取数

async function loadSummary(): Promise<void> {
  const token = authToken()
  if (token === null || !isAdmin.value) return
  loading.value = true
  loadError.value = ''
  try {
    summary.value = await fetchStatsSummary(token)
  } catch (err) {
    summary.value = null
    loadError.value = err instanceof ApiError ? err.message : '统计摘要加载失败'
  } finally {
    loading.value = false
  }
}

/** 手动刷新按钮（自动刷新之外的第二条路，卡片要求二选一，这里两个都给） */
function onManualRefresh(): void {
  void loadSummary()
}

function goAuth(): void {
  void router.push({ path: '/auth', query: { redirect: '/admin/stats' } })
}

function goHome(): void {
  void router.push('/')
}

// ---------------------------------------------------------------- 展示辅助

function percent(rate: number): string {
  if (!Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function docLink(docId: string): string {
  return `/doc/${docId}`
}

// ---------------------------------------------------------------- 启动 / 卸载

/** 自动刷新定时器；组件卸载时必须清掉，否则离开页面还在打接口 */
let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  // 子组件的 onMounted 早于 App.vue 的 restoreAuth，这里显式等一次：
  // 拿到确定的 isAdmin 才决定「显示数据」还是「显示提示页」。
  await restoreAuth()
  authChecked.value = true
  authUnverified.value = isLoggedIn.value && currentUser.value === null
  if (isAdmin.value) {
    await loadSummary()
    timer = setInterval(() => {
      void loadSummary()
    }, ADMIN_STATS_REFRESH_MS)
  }
})

onUnmounted(() => {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <div class="admin-stats">
    <!-- 未登录 / 非管理员 / 校验失败：都是提示页，绝不白屏（卡片验收②） -->
    <el-card v-if="!showPanel" shadow="never" class="deny-card">
      <el-result
        v-if="!authChecked"
        icon="info"
        title="正在校验登录态…"
        sub-title="稍等一下，马上就好"
      />
      <el-result
        v-else-if="!isLoggedIn"
        icon="warning"
        title="需要登录后访问"
        sub-title="管理统计只对登录用户开放，登录后再回来即可。"
      >
        <template #extra>
          <el-space>
            <el-button type="primary" @click="goAuth">去登录</el-button>
            <el-button @click="goHome">回首页</el-button>
          </el-space>
        </template>
      </el-result>
      <el-result
        v-else-if="authUnverified"
        icon="error"
        title="无法校验管理员身份"
        sub-title="本机后端 /api/auth/me 暂时不可用，刷新页面重试。"
      >
        <template #extra>
          <el-button @click="goHome">回首页</el-button>
        </template>
      </el-result>
      <el-result
        v-else
        icon="error"
        title="需要管理员权限"
        sub-title="当前账号不是管理员，看不到统计数据。如需开通，请让运维用 admin:promote 把该账号提为管理员。"
      >
        <template #extra>
          <el-space>
            <el-tag type="info" effect="plain">当前账号：{{ currentUser?.phone ?? '—' }}</el-tag>
            <el-button @click="goHome">回首页</el-button>
          </el-space>
        </template>
      </el-result>
    </el-card>

    <!-- 管理员视角：五块数据 -->
    <template v-else>
      <el-card shadow="never" class="head-card">
        <div class="head-row">
          <div>
            <h2 class="head-title">管理统计（最简版）</h2>
            <p class="head-sub">
              数据源：<code>GET /api/admin/stats/summary</code> · 生成于
              {{ formatTime(summary?.generatedAt ?? '') }} · 每 5 分钟自动刷新
            </p>
          </div>
          <el-button :loading="loading" @click="onManualRefresh">手动刷新</el-button>
        </div>
      </el-card>

      <el-alert
        v-if="loadError !== ''"
        class="load-error"
        type="error"
        show-icon
        :closable="false"
        :title="loadError"
        description="页面不会白屏：点「手动刷新」重试，或确认后端 4000 端口在跑。"
      />

      <template v-if="summary !== null">
        <!-- 口径说明（QA-01 P2-8 / P2-9：管理员最容易在这两处误读，故摆到最前面） -->
        <el-alert type="info" :closable="false" class="caliber-note">
          <template #title>统计口径说明（先看这段再解读下面的数字）</template>
          <ul class="caliber-list">
            <li>
              <strong>「注册用户数」与 register 事件数不相等是正常的</strong>：前者是 users
              表的行数，后者只统计<strong>经注册页提交</strong>成功的次数。站点外直接调注册接口
              创建的账号会进 users 表但不计 register 事件，所以事件数 ≤ 用户数。
            </li>
            <li>
              <strong>DownloadLog 与前端 download 事件是两个口径</strong>：DownloadLog 是后端在
              开流前写的权威记录，前端事件只覆盖「浏览器内发起的下载」。两者不等时本页只陈述差额，
              不替管理员下结论 —— 差额可能来自绕过前端的直连接口，也可能来自历史遗留或统计口径调整，
              需要按时间窗口逐段核对才能定性。
            </li>
            <li>
              <strong>AI 提问「未判定」占多数是当前已知限制</strong>：官方挂件 v0.8.2 没有回答回调，
              站内发起的提问拿不到回答证据，故一律记为未判定、不进无答案率分母。
            </li>
          </ul>
        </el-alert>

        <!-- ① 总览卡 -->
        <el-card shadow="never" class="block">
          <template #header><span class="block-title">① 总览</span></template>
          <el-row :gutter="16">
            <el-col :xs="12" :sm="6">
              <div class="metric">
                <div class="metric-value">{{ summary.totals.pv }}</div>
                <div class="metric-label">PV（page_view 次数）</div>
              </div>
            </el-col>
            <el-col :xs="12" :sm="6">
              <div class="metric">
                <div class="metric-value">{{ summary.totals.uv }}</div>
                <div class="metric-label">UV（去重访客）</div>
              </div>
            </el-col>
            <el-col :xs="12" :sm="6">
              <div class="metric">
                <div class="metric-value">{{ summary.totals.registeredUsers }}</div>
                <div class="metric-label">注册用户数（users 表行数）</div>
              </div>
            </el-col>
            <el-col :xs="12" :sm="6">
              <div class="metric">
                <div class="metric-value">{{ summary.totals.events }}</div>
                <div class="metric-label">事件总数（全部事件）</div>
              </div>
            </el-col>
          </el-row>
        </el-card>

        <!-- ② 事件分布表（7 类） -->
        <el-card shadow="never" class="block">
          <template #header><span class="block-title">② 事件分布（7 类）</span></template>
          <el-table :data="eventRows" stripe style="width: 100%">
            <el-table-column prop="label" label="事件" min-width="220" />
            <el-table-column prop="count" label="次数" width="100" align="right" />
            <el-table-column label="占比" width="160">
              <template #default="scope">
                {{
                  percent(summary.totals.events === 0 ? 0 : scope.row.count / summary.totals.events)
                }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- ③ 检索热词 Top10 -->
        <el-card shadow="never" class="block">
          <template #header>
            <span class="block-title">③ 检索热词 Top10</span>
          </template>
          <el-table
            v-if="summary.topSearchTerms.length > 0"
            :data="summary.topSearchTerms"
            stripe
            style="width: 100%"
          >
            <el-table-column type="index" label="#" width="60" align="center" />
            <el-table-column prop="term" label="检索词" min-width="240" />
            <el-table-column prop="count" label="次数" width="100" align="right" />
          </el-table>
          <el-empty v-else description="暂无检索记录" />
        </el-card>

        <!-- ④ 零结果词列表 = 内容缺口线索 -->
        <el-card shadow="never" class="block">
          <template #header>
            <div class="block-head">
              <span class="block-title">④ 零结果词列表（内容缺口线索）</span>
              <el-tag type="warning" effect="plain"
                >这些词在书架里搜不到资料，是补内容的优先线索</el-tag
              >
            </div>
          </template>
          <el-table
            v-if="summary.zeroResultSearchTerms.length > 0"
            :data="summary.zeroResultSearchTerms"
            stripe
            style="width: 100%"
          >
            <el-table-column type="index" label="#" width="60" align="center" />
            <el-table-column prop="term" label="零结果检索词" min-width="240" />
            <el-table-column prop="count" label="次数" width="100" align="right" />
            <el-table-column label="线索" min-width="120">
              <template #default>
                <el-tag type="warning" size="small">内容缺口线索</el-tag>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无零结果检索（说明现有资料都搜得到）" />
        </el-card>

        <!-- ⑤ 下载 Top10 + AI 提问板块 -->
        <el-row :gutter="16" class="block-row">
          <el-col :xs="24" :md="14">
            <el-card shadow="never" class="block">
              <template #header><span class="block-title">⑤ 下载 Top10</span></template>
              <el-table
                v-if="summary.topDownloads.length > 0"
                :data="summary.topDownloads"
                stripe
                style="width: 100%"
              >
                <el-table-column type="index" label="#" width="60" align="center" />
                <el-table-column label="文件名" min-width="260" show-overflow-tooltip>
                  <template #default="scope">
                    <router-link :to="docLink(scope.row.docId)" class="doc-link">
                      {{ scope.row.fileName }}
                    </router-link>
                  </template>
                </el-table-column>
                <el-table-column prop="count" label="次数" width="90" align="right" />
              </el-table>
              <el-empty v-else description="暂无下载记录" />
              <p class="note">
                下载口径（后端双写）：DownloadLog {{ summary.downloads.logRows }} 行（服务端权威）
                ／ 前端埋点 {{ summary.downloads.events }} 条 —
                <el-tag
                  :type="downloadGap === 0 ? 'success' : 'warning'"
                  size="small"
                  effect="plain"
                >
                  {{ downloadGap === 0 ? '两者一致' : `差额 ${downloadGap} 条（原因待查）` }}
                </el-tag>
              </p>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="10">
            <el-card shadow="never" class="block">
              <template #header><span class="block-title">⑥ AI 提问</span></template>
              <el-descriptions :column="1" border>
                <el-descriptions-item label="提问总数">
                  {{ summary.asks.total }}
                </el-descriptions-item>
                <el-descriptions-item label="无答案率">
                  <strong>{{ noAnswerRateText }}</strong>
                </el-descriptions-item>
                <el-descriptions-item label="已判定">
                  {{ summary.asks.judged }}
                </el-descriptions-item>
                <el-descriptions-item label="未判定">
                  {{ summary.asks.unjudged }}
                </el-descriptions-item>
              </el-descriptions>
              <p class="note">
                口径（照抄后端，不在页面二次解释）：无答案率 = 无答案 {{ summary.asks.noAnswer }} ÷
                已判定 {{ summary.asks.judged }}；未判定 {{ summary.asks.unjudged }}
                条不进分母。官方挂件在面板里直接打字的问题拿不到回答证据，会记为「未判定」。
              </p>
            </el-card>
          </el-col>
        </el-row>
      </template>
    </template>
  </div>
</template>

<style scoped>
.admin-stats {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.deny-card {
  margin-top: 24px;
}

.head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.head-title {
  margin: 0;
  font-size: 20px;
}

.head-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.load-error {
  margin: 0;
}

.caliber-list {
  margin: 8px 0 0;
  padding-left: 20px;
  line-height: 1.8;
}

.block {
  height: 100%;
}

.block-title {
  font-weight: 600;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.block-row {
  align-items: stretch;
}

.metric {
  padding: 8px 0;
}

.metric-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.metric-label {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.doc-link {
  color: var(--el-color-primary);
  text-decoration: none;
}

.note {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
