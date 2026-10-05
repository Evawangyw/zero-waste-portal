<script setup lang="ts">
// 基金会介绍页：把安徽省六尺巷慈善基金会官网的公开介绍，放到本知识库站点里。
// 事实来自 frontend/src/content/foundation.ts，页面只负责排版和打开官网链接。
import {
  FOUNDATION_AREAS,
  FOUNDATION_BOARD,
  FOUNDATION_DIRECTIONS,
  FOUNDATION_FACTS,
  FOUNDATION_HOME,
  FOUNDATION_NEWS,
  FOUNDATION_PAGES,
  FOUNDATION_TEAM,
} from '../content/foundation'

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="foundation">
    <header class="hero">
      <p class="eyebrow">公益机构介绍</p>
      <h1>安徽省六尺巷慈善基金会</h1>
      <p class="lead">
        简称六尺巷基金会。2017 年 12 月由青年歌唱家、音乐创作人张正扬创办，以包容、谦和、礼让的「六尺巷」精神为核心，践行社会主义核心价值观，开展公益慈善活动。
      </p>
      <p class="lead">
        官网写下的愿景是「更高品质和更有文化的生活」：让促进人与人之间包容礼让、人与自然之间和谐共生的想法和行动，更富吸引力，并获得更多社会支持。
      </p>
      <div class="actions">
        <el-button type="primary" @click="openExternal(FOUNDATION_HOME)">访问基金会官网</el-button>
        <el-button @click="openExternal('https://www.lcx-foundation.org.cn/h-col-112.html')">
          阅读机构简介原文
        </el-button>
      </div>
      <p class="motto">六尺归心、礼让自然</p>
    </header>

    <dl class="facts">
      <div v-for="fact in FOUNDATION_FACTS" :key="fact.label" class="fact">
        <dt>{{ fact.label }}</dt>
        <dd>{{ fact.value }}</dd>
      </div>
    </dl>

    <section>
      <h2>机构在做什么</h2>
      <p class="section-desc">
        早期行动包括助残义演、爱心捐赠、疫情防控物资，以及眼疾救助和脱贫攻坚捐助。2024 年基金会启动新发展战略，把工作收束到下面三个方向。
      </p>
      <div class="grid-3">
        <article v-for="item in FOUNDATION_DIRECTIONS" :key="item.title" class="panel">
          <h3>{{ item.title }}</h3>
          <p>{{ item.summary }}</p>
        </article>
      </div>
    </section>

    <section>
      <h2>官网工作专栏</h2>
      <p class="section-desc">
        首页把工作分成五个领域。本知识库收录的零废弃政策与实践资料，对应其中的「零废弃」专栏。
      </p>
      <div class="areas">
        <article v-for="area in FOUNDATION_AREAS" :key="area.title" class="panel area">
          <div>
            <h3>{{ area.title }}</h3>
            <p>{{ area.summary }}</p>
            <p v-if="area.projects.length > 0" class="projects">
              <span>专栏中的项目</span>
              {{ area.projects.join('、') }}
            </p>
          </div>
          <el-button size="small" plain @click="openExternal(area.href)">在官网查看</el-button>
        </article>
      </div>
    </section>

    <section class="split">
      <article class="panel">
        <h2>理事会和监事会</h2>
        <ul class="people">
          <li v-for="person in FOUNDATION_BOARD" :key="person.name + person.role">
            <strong>{{ person.name }}</strong>
            <span>{{ person.role }}</span>
          </li>
        </ul>
      </article>
      <article class="panel">
        <h2>团队</h2>
        <ul class="people">
          <li v-for="person in FOUNDATION_TEAM" :key="person.name + person.role">
            <strong>{{ person.name }}</strong>
            <span>{{ person.role }}</span>
          </li>
        </ul>
        <p class="note">职务以官网「理事会和监事会」「团队成员」页面公示为准。</p>
      </article>
    </section>

    <section>
      <h2>官网近期文章</h2>
      <p class="section-desc">以下三篇是整理本页时，官网首页「最新资讯」展示的文章。</p>
      <ul class="news">
        <li v-for="item in FOUNDATION_NEWS" :key="item.href">
          <el-link :href="item.href" target="_blank" rel="noopener noreferrer">
            {{ item.title }}
          </el-link>
          <time :datetime="item.date">{{ item.date }}</time>
        </li>
      </ul>
    </section>

    <section class="panel contact">
      <h2>联系与公开信息</h2>
      <div class="contact-grid">
        <p>
          <span>邮箱</span>
          <a href="mailto:info@lcx-foundation.org.cn">info@lcx-foundation.org.cn</a>
        </p>
        <p>
          <span>联系我们页地址</span>
          安徽省合肥市蜀山区国祯广场负一层 C 区 1053（邮编 230031）
        </p>
        <p>
          <span>官网页脚地址</span>
          安徽省合肥市蜀山区潜山南路卓誉中心 2303
        </p>
      </div>
      <div class="page-links">
        <el-button
          v-for="page in FOUNDATION_PAGES"
          :key="page.href"
          size="small"
          @click="openExternal(page.href)"
        >
          {{ page.label }}
        </el-button>
      </div>
      <p class="note">本页根据基金会官网公开内容整理，章程、年报、审计报告等原文请从「信息公开」查阅。</p>
    </section>
  </div>
</template>

<style scoped>
.foundation {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.hero {
  padding: 28px 0 8px;
  border-bottom: 1px solid var(--zw-line);
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--zw-green);
  font-size: 13px;
  letter-spacing: 0.14em;
}

h1 {
  margin: 0 0 14px;
  font-size: 32px;
  line-height: 1.3;
}

.foundation > section > h2 {
  margin: 0 0 14px;
  padding: 10px 16px;
  background: var(--zw-green);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.panel h2 {
  margin: 0 0 8px;
  padding: 0;
  background: none;
  color: var(--zw-green);
  font-size: 18px;
}

h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.lead {
  max-width: 760px;
  margin: 0 0 10px;
  color: var(--el-text-color-regular);
  line-height: 1.8;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.motto {
  margin: 22px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  color: var(--zw-green);
  font-size: 18px;
  letter-spacing: 0.08em;
}

.facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.fact {
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 0;
  background: #fff;
}

.fact dt {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.fact dd {
  margin: 8px 0 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
}

.section-desc,
.note,
.projects,
.panel p {
  color: var(--el-text-color-secondary);
  line-height: 1.75;
}

.section-desc {
  margin: 0 0 14px;
}

.grid-3,
.areas,
.split {
  display: grid;
  gap: 12px;
}

.grid-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.areas {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.split {
  grid-template-columns: 1.4fr 0.8fr;
}

.panel {
  padding: 18px 18px 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 0;
  background: #fff;
}

.area {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
}

.area p,
.panel p {
  margin: 0;
}

.projects {
  margin-top: 10px !important;
  font-size: 13px;
}

.projects span {
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-regular);
}

.people {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.people li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 14px;
}

.people span {
  color: var(--el-text-color-secondary);
}

.note {
  margin: 12px 0 0;
  font-size: 13px;
}

.news {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--el-border-color-light);
  border-radius: 0;
  background: #fff;
}

.news li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.news li:last-child {
  border-bottom: 0;
}

.news time {
  flex: none;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.contact-grid {
  display: grid;
  gap: 10px;
  margin: 12px 0 16px;
}

.contact-grid p {
  margin: 0;
}

.contact-grid span {
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.contact-grid a {
  color: var(--el-color-primary);
}

.page-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 900px) {
  .facts,
  .grid-3,
  .split {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .hero {
    padding: 24px 16px 20px;
  }

  h1 {
    font-size: 26px;
  }

  .facts,
  .grid-3,
  .areas,
  .split,
  .people {
    grid-template-columns: 1fr;
  }

  .news li {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
