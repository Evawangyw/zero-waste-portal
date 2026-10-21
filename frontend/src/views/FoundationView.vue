<script setup lang="ts">
// 关于零废弃知识库：放基金会简介，跳到机构官网，并留下合作方式。
import {
  FOUNDATION_ADDRESS,
  FOUNDATION_EMAIL,
  FOUNDATION_HOME,
  FOUNDATION_INTRO,
  FOUNDATION_MOTTO,
} from '../content/foundation'
</script>

<template>
  <div class="foundation">
    <header class="hero">
      <p class="eyebrow">关于零废弃知识库</p>
      <h1>安徽省六尺巷慈善基金会</h1>
      <p class="lead">{{ FOUNDATION_INTRO }}</p>
      <p class="motto">{{ FOUNDATION_MOTTO }}</p>
      <a class="site-link" :href="FOUNDATION_HOME" target="_blank" rel="noopener noreferrer">
        访问机构官网
      </a>
    </header>

    <section class="panel">
      <h2>合作方式</h2>
      <p>
        <span>邮箱</span>
        <a :href="`mailto:${FOUNDATION_EMAIL}`">{{ FOUNDATION_EMAIL }}</a>
      </p>
      <p>
        <span>地址</span>
        {{ FOUNDATION_ADDRESS }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.foundation {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 760px;
}

.hero {
  padding: 28px 0 8px;
  border-bottom: 1px solid var(--zw-line);
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--rust);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

h1 {
  margin: 0 0 14px;
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 36px;
  line-height: 1.25;
}

h2 {
  margin: 0 0 14px;
  color: var(--forest-deep);
  font-family: var(--serif);
  font-size: 28px;
  font-weight: 700;
}

.lead {
  margin: 0;
  color: var(--el-text-color-regular);
  line-height: 1.8;
}

.motto {
  margin: 18px 0 0;
  color: var(--zw-green);
  font-size: 18px;
  letter-spacing: 0.08em;
}

.site-link {
  display: inline-block;
  margin-top: 22px;
  padding: 10px 18px;
  background: var(--forest);
  color: #fff;
  font-weight: 700;
  text-decoration: none;
}

.site-link:hover {
  background: var(--forest-deep);
}

.panel {
  padding: 18px;
  border: 1px solid var(--el-border-color-light);
  background: #fff;
}

.panel p {
  margin: 0 0 12px;
  line-height: 1.7;
}

.panel p:last-child {
  margin-bottom: 0;
}

.panel span {
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.panel a {
  color: var(--forest);
}

@media (max-width: 640px) {
  h1 {
    font-size: 26px;
  }

  .hero {
    padding-top: 8px;
  }
}
</style>
