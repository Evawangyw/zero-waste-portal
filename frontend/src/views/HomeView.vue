<script setup lang="ts">
import type { CardItem } from '../types/placeholder'

interface FeatureInfo {
  readonly title: string
  readonly desc: string
}

const features: readonly CardItem<FeatureInfo>[] = [
  { title: '资料书架', desc: '按机构 / 年份 / 类型 / 标签检索零废弃政策与研究报告' },
  { title: 'AI 问答', desc: '基于知识库生成带出处的回答，答案不足会明确告知' },
  { title: '公众提交', desc: '欢迎提交你的资料，审核通过后正式入库' },
  { title: '数据看板', desc: '提问量、无答案率、热门下载一屏掌握' },
]

const tag = 'zero-waste-portal · T00 脚手架'
</script>

<template>
  <el-container class="placeholder-page">
    <el-header class="placeholder-header">
      <span class="brand">零废弃知识库</span>
      <el-tag type="info" size="small" effect="plain">{{ tag }}</el-tag>
    </el-header>

    <el-main>
      <el-card shadow="never" class="hero-card">
        <h1 class="hero-title">零废弃知识库</h1>
        <p class="hero-desc">
          面向公众的零废弃政策与实践资料库。当前为工程脚手架占位页，业务页面由后续任务卡接入。
        </p>
        <el-space wrap>
          <el-button type="primary" disabled>资料书架（待接入）</el-button>
          <el-button disabled>AI 问答（待接入）</el-button>
        </el-space>
      </el-card>

      <el-row :gutter="16" class="feature-row">
        <el-col v-for="item in features" :key="item.title" :xs="24" :sm="12" :lg="6">
          <el-card shadow="hover" class="feature-card">
            <template #header>
              <strong>{{ item.title }}</strong>
            </template>
            <span class="feature-desc">{{ item.desc }}</span>
          </el-card>
        </el-col>
      </el-row>

      <el-alert
        class="t00-note"
        type="info"
        show-icon
        :closable="false"
        title="T00 空壳说明"
        description="前端仅验证 Vite + Vue3 + TypeScript + Element Plus 可跑通；页面不含任何业务路由与接口调用。"
      />
    </el-main>
  </el-container>
</template>

<style scoped>
.placeholder-page {
  min-height: 100vh;
}

.placeholder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color-light);
}

.brand {
  font-size: 18px;
  font-weight: 700;
  color: var(--el-color-primary);
}

.hero-card {
  margin-bottom: 20px;
}

.hero-title {
  margin: 0 0 12px;
  font-size: 30px;
  line-height: 1.3;
}

.hero-desc {
  margin: 0 0 20px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}

.feature-row {
  margin-bottom: 20px;
}

.feature-card {
  height: 100%;
}

.feature-desc {
  color: var(--el-text-color-regular);
  line-height: 1.7;
}
</style>
