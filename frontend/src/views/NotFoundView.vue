<script setup lang="ts">
// 404 兜底页（T05）：路径写错时给回首页/书架两个出口，不做美化。
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <el-result icon="warning" title="页面不存在" sub-title="你访问的地址可能已失效或输错了">
    <template #extra>
      <el-button type="primary" @click="router.push('/')">回首页</el-button>
      <el-button @click="router.push('/shelf')">去书架</el-button>
    </template>
  </el-result>
</template>
