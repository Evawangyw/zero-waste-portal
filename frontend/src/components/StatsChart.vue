<script setup lang="ts">
// 管理统计页的图表。只负责把 option 画出来，并在点击柱子或扇区时把名称交回页面。
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { init, use, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { BarChart, HeatmapChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([
  BarChart,
  HeatmapChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
])

const props = withDefaults(
  defineProps<{
    option: EChartsCoreOption
    height?: number
  }>(),
  { height: 280 },
)

const emit = defineEmits<{
  select: [name: string]
}>()

const host = ref<HTMLDivElement | null>(null)
let chart: ECharts | null = null
let observer: ResizeObserver | null = null

function readName(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return ''
  const record = raw as { readonly name?: unknown; readonly data?: unknown }
  if (typeof record.data === 'object' && record.data !== null && 'name' in record.data) {
    const dataName = (record.data as { readonly name?: unknown }).name
    if (typeof dataName === 'string' && dataName !== '') return dataName
  }
  return typeof record.name === 'string' ? record.name : ''
}

function render(): void {
  chart?.setOption(props.option, true)
}

onMounted(() => {
  if (host.value === null) return
  chart = init(host.value)
  chart.on('click', (params) => {
    const name = readName(params)
    if (name !== '') emit('select', name)
  })
  render()
  observer = new ResizeObserver(() => {
    chart?.resize()
  })
  observer.observe(host.value)
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})

watch(() => props.option, render)
</script>

<template>
  <div ref="host" class="stats-chart" :style="{ height: `${height}px` }"></div>
</template>

<style scoped>
.stats-chart {
  width: 100%;
}
</style>
