<script setup lang="ts">
// 注册前的知识库介绍。数据来自 content/knowledge-overview.ts（钉钉「知识总览」快照）。
// 未登录第一次进首页或登录页时，路由会先送到这里；看完或跳过之后，本会话不再自动播放。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CHEMICAL_TOTAL,
  CHEMICAL_TYPES,
  OVERVIEW_AS_OF,
  ZERO_WASTE_TOPICS,
  ZERO_WASTE_TOTAL,
  ZERO_WASTE_TYPES,
  ZERO_WASTE_YEARS,
  shareLabel,
} from '../content/knowledge-overview'
import { isLoggedIn } from '../composables/useAuth'
import { markIntroSeen, safeInternalPath } from '../composables/useIntroGate'

const SCENES = [
  { id: 'open', label: '开场' },
  { id: 'totals', label: '规模' },
  { id: 'topics', label: '议题' },
  { id: 'types', label: '类型' },
  { id: 'years', label: '年份' },
  { id: 'chemical', label: '化学品' },
  { id: 'close', label: '进入' },
] as const

const SCENE_MS = 5200

const route = useRoute()
const router = useRouter()

const scene = ref(0)
const shownZero = ref(0)
const shownChemical = ref(0)
const stage = ref<HTMLElement | null>(null)
const autoplay = ref(true)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

let timer: ReturnType<typeof setTimeout> | undefined
let countGen = 0

const lastIndex = SCENES.length - 1
const yearPeak = computed(() => Math.max(...ZERO_WASTE_YEARS.map((item) => item.count)))
const topicPeak = computed(() => ZERO_WASTE_TOPICS[0]?.count ?? 1)
const typePeak = computed(() => ZERO_WASTE_TYPES[0]?.count ?? 1)
const chemicalPeak = computed(() => Math.max(...CHEMICAL_TYPES.map((item) => item.count)))
const redirectPath = computed(() => {
  if (route.query['redirect'] === undefined) return ''
  return safeInternalPath(route.query['redirect'], '')
})
const cameForAuth = computed(() => safeInternalPath(route.query['next'], '/') === '/auth')

if (reducedMotion) autoplay.value = false

function clearTimer(): void {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
}

function armAutoplay(): void {
  clearTimer()
  if (!autoplay.value || reducedMotion || scene.value >= lastIndex) return
  timer = setTimeout(() => {
    if (scene.value < lastIndex) scene.value += 1
  }, SCENE_MS)
}

function stopAutoplay(): void {
  autoplay.value = false
  clearTimer()
}

function goScene(index: number): void {
  stopAutoplay()
  scene.value = Math.min(lastIndex, Math.max(0, index))
}

function nextScene(): void {
  if (scene.value >= lastIndex) {
    goRegister()
    return
  }
  goScene(scene.value + 1)
}

function prevScene(): void {
  goScene(scene.value - 1)
}

function playTotals(): void {
  const gen = ++countGen
  if (reducedMotion) {
    shownZero.value = ZERO_WASTE_TOTAL
    shownChemical.value = CHEMICAL_TOTAL
    return
  }
  const start = performance.now()
  shownZero.value = 0
  shownChemical.value = 0
  const step = (now: number): void => {
    if (gen !== countGen) return
    const t = Math.min(1, (now - start) / 1100)
    const eased = 1 - (1 - t) ** 3
    shownZero.value = Math.round(ZERO_WASTE_TOTAL * eased)
    shownChemical.value = Math.round(CHEMICAL_TOTAL * eased)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function authLocation(tab: 'login' | 'register'): { path: string; query: Record<string, string> } {
  const query: Record<string, string> = { from: 'intro', tab, skipIntro: '1' }
  if (redirectPath.value !== '') query['redirect'] = redirectPath.value
  return { path: '/auth', query }
}

function goRegister(): void {
  markIntroSeen()
  if (isLoggedIn.value) {
    void router.push('/')
    return
  }
  void router.push(authLocation('register'))
}

function goLogin(): void {
  markIntroSeen()
  if (isLoggedIn.value) {
    void router.push('/')
    return
  }
  void router.push(authLocation('login'))
}

function goHome(): void {
  markIntroSeen()
  void router.push('/')
}

function skip(): void {
  if (cameForAuth.value) goLogin()
  else goHome()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    nextScene()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    prevScene()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    skip()
  }
}

watch(scene, (index) => {
  if (index === 1) playTotals()
  armAutoplay()
})

onMounted(() => {
  stage.value?.focus()
  if (scene.value === 1) playTotals()
  armAutoplay()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  clearTimer()
  countGen += 1
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="stage" class="intro" tabindex="-1">
    <div class="progress" :style="{ '--step': String(scene), '--total': String(SCENES.length) }">
      <span />
    </div>

    <header class="topbar">
      <p class="brand">零废弃知识库</p>
      <button type="button" class="text-btn" @click="skip">跳过</button>
    </header>

    <Transition name="scene" mode="out-in">
      <section v-if="scene === 0" key="open" class="panel">
        <p class="kicker">安徽省六尺巷慈善基金会</p>
        <h1>注册之前，先看这间库里有什么</h1>
        <p class="lead">
          库分两块：零废弃，以及化学品。下面按知识总览，把规模、议题、类型和年份过一遍。
        </p>
      </section>

      <section v-else-if="scene === 1" key="totals" class="panel">
        <p class="kicker">规模</p>
        <h1>两块库，现在各有多少</h1>
        <div class="totals">
          <article>
            <p class="figure">{{ shownZero }}</p>
            <h2>零废弃</h2>
            <p>政策、研究和社区实践资料。</p>
          </article>
          <article>
            <p class="figure">{{ shownChemical }}</p>
            <h2>化学品</h2>
            <p>标准、公约、国内法规和研究报告。</p>
          </article>
        </div>
        <p class="footnote">数字来自知识总览，截至 {{ OVERVIEW_AS_OF }}。</p>
      </section>

      <section v-else-if="scene === 2" key="topics" class="panel panel-top">
        <p class="kicker">零废弃 · 议题</p>
        <h1>塑料、垃圾分类、禁塑最厚</h1>
        <p class="lead">17 个议题，一共 {{ ZERO_WASTE_TOTAL }} 条。</p>
        <ol class="bars">
          <li v-for="(item, index) in ZERO_WASTE_TOPICS" :key="item.name">
            <span class="bar-name">{{ item.name }}</span>
            <span class="bar-track">
              <span
                class="bar-fill"
                :style="{
                  width: `${(item.count / topicPeak) * 100}%`,
                  animationDelay: `${index * 35}ms`,
                }"
              />
            </span>
            <span class="bar-count">{{ item.count }} · {{ shareLabel(item.count, ZERO_WASTE_TOTAL) }}</span>
          </li>
        </ol>
      </section>

      <section v-else-if="scene === 3" key="types" class="panel">
        <p class="kicker">零废弃 · 知识类型</p>
        <h1>政策法规和研究报告是主体</h1>
        <ol class="bars bars-loose">
          <li v-for="(item, index) in ZERO_WASTE_TYPES" :key="item.name">
            <span class="bar-name">{{ item.name }}</span>
            <span class="bar-track">
              <span
                class="bar-fill"
                :style="{
                  width: `${(item.count / typePeak) * 100}%`,
                  animationDelay: `${index * 80}ms`,
                }"
              />
            </span>
            <span class="bar-count">{{ item.count }} · {{ shareLabel(item.count, ZERO_WASTE_TOTAL) }}</span>
          </li>
        </ol>
      </section>

      <section v-else-if="scene === 4" key="years" class="panel">
        <p class="kicker">零废弃 · 年份</p>
        <h1>2020 年最多，74 条</h1>
        <p class="lead">看板上从 2001 年排到 2026 年。2006 到 2011 年没有柱。</p>
        <div class="year-scroll">
          <div class="year-plot">
            <div v-for="(item, index) in ZERO_WASTE_YEARS" :key="item.year" class="year">
              <span class="year-count">{{ item.count }}</span>
              <div class="year-box">
                <div
                  class="year-col"
                  :class="{ peak: item.year === '2020' }"
                  :style="{
                    height: `${(item.count / yearPeak) * 100}%`,
                    animationDelay: `${index * 30}ms`,
                  }"
                />
              </div>
              <span class="year-label">{{ item.year }}</span>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="scene === 5" key="chemical" class="panel">
        <p class="kicker">化学品 · {{ CHEMICAL_TOTAL }} 条</p>
        <h1>研究报告、标准，和国内法规</h1>
        <ol class="bars bars-loose">
          <li v-for="(item, index) in CHEMICAL_TYPES" :key="item.name">
            <span class="bar-name">{{ item.name }}</span>
            <span class="bar-track">
              <span
                class="bar-fill bar-fill-chem"
                :style="{
                  width: `${(item.count / chemicalPeak) * 100}%`,
                  animationDelay: `${index * 80}ms`,
                }"
              />
            </span>
            <span class="bar-count">{{ item.count }} · {{ shareLabel(item.count, CHEMICAL_TOTAL) }}</span>
          </li>
        </ol>
      </section>

      <section v-else key="close" class="panel">
        <p class="kicker">然后</p>
        <h1>登录后可以使用这些资料</h1>
        <p class="lead">
          可以按议题翻书架，也可以向 AI 提问。回答只依据库内资料；库里没有的，会直接说没有。
        </p>
        <div class="close-actions">
          <button type="button" class="btn btn-primary" @click="goRegister">
            {{ isLoggedIn ? '进入知识库' : '去注册' }}
          </button>
          <button v-if="!isLoggedIn" type="button" class="btn btn-ghost" @click="goLogin">
            已有账号，登录
          </button>
          <button type="button" class="btn btn-ghost" @click="goHome">先看基金会</button>
        </div>
      </section>
    </Transition>

    <footer class="dock">
      <button type="button" class="text-btn" :disabled="scene === 0" @click="prevScene">上一幕</button>
      <div class="dots" role="tablist" aria-label="介绍进度">
        <button
          v-for="(item, index) in SCENES"
          :key="item.id"
          type="button"
          class="dot"
          :class="{ on: index === scene }"
          :aria-label="item.label"
          :aria-selected="index === scene"
          role="tab"
          @click="goScene(index)"
        />
      </div>
      <button type="button" class="text-btn" @click="nextScene">
        {{ scene === lastIndex ? (isLoggedIn ? '进入' : '去注册') : '下一幕' }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.intro {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(900px 420px at 12% -10%, rgba(1, 124, 64, 0.45), transparent 60%),
    #10241c;
  color: #f3f7f4;
  outline: none;
}

.progress {
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
}

.progress > span {
  display: block;
  height: 100%;
  width: calc((var(--step) + 1) / var(--total) * 100%);
  background: #8fd6b0;
  transition: width 0.35s ease;
}

.topbar,
.dock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 22px;
}

.brand,
.kicker,
.footnote,
.year-count,
.year-label,
.bar-count {
  margin: 0;
  color: rgba(243, 247, 244, 0.72);
  font-size: 13px;
  letter-spacing: 0.04em;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: min(1080px, calc(100% - 36px));
  margin: 0 auto;
  overflow: auto;
  padding: 8px 0 12px;
}

.panel-top {
  justify-content: flex-start;
  padding-top: 18px;
}

h1 {
  margin: 8px 0 12px;
  font-size: clamp(28px, 4vw, 46px);
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: 0.01em;
}

.lead {
  max-width: 40rem;
  margin: 0;
  color: rgba(243, 247, 244, 0.86);
  font-size: 17px;
  line-height: 1.7;
}

.totals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 28px;
}

.totals article {
  padding: 22px 22px 18px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
}

.figure {
  margin: 0;
  color: #fff;
  font-size: clamp(64px, 9vw, 104px);
  font-weight: 700;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
}

.totals h2 {
  margin: 10px 0 6px;
  font-size: 20px;
}

.totals p {
  margin: 0;
  color: rgba(243, 247, 244, 0.75);
}

.footnote {
  margin-top: 16px;
}

.bars {
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.bars-loose {
  gap: 16px;
  margin-top: 28px;
}

.bars li {
  display: grid;
  grid-template-columns: 9.5em 1fr auto;
  gap: 10px;
  align-items: center;
}

.bar-name {
  font-size: 14px;
}

.bar-track {
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
}

.bars-loose .bar-track {
  height: 14px;
}

.bar-fill {
  display: block;
  height: 100%;
  background: #3cba78;
  transform-origin: left center;
  animation: grow-x 0.7s ease both;
}

.bar-fill-chem {
  background: #d7e26a;
}

.bar-count {
  min-width: 7.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.year-scroll {
  margin-top: 22px;
  overflow-x: auto;
}

.year-plot {
  display: flex;
  align-items: stretch;
  gap: 6px;
  min-width: 720px;
  height: 280px;
}

.year {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 28px;
}

.year-box {
  flex: 1;
  display: flex;
  align-items: flex-end;
  width: 100%;
}

.year-col {
  width: 100%;
  min-height: 3px;
  background: #3cba78;
  transform-origin: bottom center;
  animation: grow-y 0.65s ease both;
}

.year-col.peak {
  background: #f2f6ef;
}

.year-count {
  margin-bottom: 4px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.year-label {
  margin-top: 6px;
  font-size: 11px;
  letter-spacing: 0;
}

.close-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 26px;
}

.btn,
.text-btn,
.dot {
  font: inherit;
  cursor: pointer;
}

.btn {
  border: 1px solid transparent;
  padding: 10px 18px;
}

.btn-primary {
  background: #017c40;
  color: #fff;
}

.btn-ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
}

.text-btn {
  border: 0;
  background: transparent;
  color: rgba(243, 247, 244, 0.8);
  padding: 6px 0;
}

.text-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.dots {
  display: flex;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: rgba(255, 255, 255, 0.28);
}

.dot.on {
  background: #fff;
  width: 22px;
}

.scene-enter-active {
  animation: scene-in 0.45s ease;
}

.scene-leave-active {
  animation: scene-in 0.22s ease reverse;
}

@keyframes scene-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes grow-x {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

@keyframes grow-y {
  from {
    transform: scaleY(0);
  }
  to {
    transform: scaleY(1);
  }
}

@media (max-width: 720px) {
  .totals,
  .bars li {
    grid-template-columns: 1fr;
  }

  .bar-count {
    text-align: left;
  }

  h1 {
    font-size: 28px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scene-enter-active,
  .scene-leave-active,
  .bar-fill,
  .year-col,
  .progress > span {
    animation: none;
    transition: none;
  }
}
</style>
