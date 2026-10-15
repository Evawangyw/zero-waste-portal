<script setup lang="ts">
// 把问答正文里的 Markdown 渲染成标题、加粗、列表、表格和图片。引用仍是可点击的编号。
import { computed } from 'vue'
import { parseAnswerMarkdown } from './answer-markdown'
import type { InlinePiece } from './answer-markdown'

const props = defineProps<{
  readonly body: string
}>()

const emit = defineEmits<{
  cite: [index: number]
}>()

const blocks = computed(() => parseAnswerMarkdown(props.body))

function piecesOf(pieces: readonly InlinePiece[]): readonly InlinePiece[] {
  return pieces
}
</script>

<template>
  <div v-if="blocks.length > 0" class="answer-md">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <h2 v-if="block.kind === 'heading' && block.level === 2">
        <template v-for="(piece, pieceIndex) in piecesOf(block.pieces)" :key="pieceIndex">
          <button v-if="piece.kind === 'cite'" type="button" class="inline-citation" @click="emit('cite', piece.index)">
            {{ piece.index }}
          </button>
          <strong v-else-if="piece.kind === 'strong'">{{ piece.text }}</strong>
          <template v-else>{{ piece.text }}</template>
        </template>
      </h2>
      <h3 v-else-if="block.kind === 'heading' && block.level === 3">
        <template v-for="(piece, pieceIndex) in piecesOf(block.pieces)" :key="pieceIndex">
          <button v-if="piece.kind === 'cite'" type="button" class="inline-citation" @click="emit('cite', piece.index)">
            {{ piece.index }}
          </button>
          <strong v-else-if="piece.kind === 'strong'">{{ piece.text }}</strong>
          <template v-else>{{ piece.text }}</template>
        </template>
      </h3>
      <h4 v-else-if="block.kind === 'heading'">
        <template v-for="(piece, pieceIndex) in piecesOf(block.pieces)" :key="pieceIndex">
          <button v-if="piece.kind === 'cite'" type="button" class="inline-citation" @click="emit('cite', piece.index)">
            {{ piece.index }}
          </button>
          <strong v-else-if="piece.kind === 'strong'">{{ piece.text }}</strong>
          <template v-else>{{ piece.text }}</template>
        </template>
      </h4>
      <p v-else-if="block.kind === 'bullet'" class="answer-bullet">
        <span class="marker">{{ block.marker }}</span>
        <span>
        <template v-for="(piece, pieceIndex) in piecesOf(block.pieces)" :key="pieceIndex">
          <button v-if="piece.kind === 'cite'" type="button" class="inline-citation" @click="emit('cite', piece.index)">
            {{ piece.index }}
          </button>
          <strong v-else-if="piece.kind === 'strong'">{{ piece.text }}</strong>
          <template v-else>{{ piece.text }}</template>
        </template>
        </span>
      </p>
      <hr v-else-if="block.kind === 'rule'" />
      <figure v-else-if="block.kind === 'image'" class="answer-figure">
        <el-image :src="block.url" :alt="block.alt" :preview-src-list="[block.url]" fit="contain" />
        <figcaption v-if="block.alt !== ''">{{ block.alt }}</figcaption>
      </figure>
      <div v-else-if="block.kind === 'table'" class="answer-table-wrap">
        <table>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <component
                :is="rowIndex === 0 ? 'th' : 'td'"
                v-for="(cell, cellIndex) in row"
                :key="cellIndex"
              >
                <template v-for="(piece, pieceIndex) in piecesOf(cell)" :key="pieceIndex">
                  <button
                    v-if="piece.kind === 'cite'"
                    type="button"
                    class="inline-citation"
                    @click="emit('cite', piece.index)"
                  >
                    {{ piece.index }}
                  </button>
                  <strong v-else-if="piece.kind === 'strong'">{{ piece.text }}</strong>
                  <template v-else>{{ piece.text }}</template>
                </template>
              </component>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else-if="block.kind === 'paragraph'">
        <template v-for="(piece, pieceIndex) in piecesOf(block.pieces)" :key="pieceIndex">
          <button v-if="piece.kind === 'cite'" type="button" class="inline-citation" @click="emit('cite', piece.index)">
            {{ piece.index }}
          </button>
          <strong v-else-if="piece.kind === 'strong'">{{ piece.text }}</strong>
          <template v-else>{{ piece.text }}</template>
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.answer-md :is(h2, h3, h4) {
  margin: 18px 0 8px;
  color: #143024;
  font-weight: 700;
  line-height: 1.45;
}

.answer-md h2 {
  font-size: 18px;
}

.answer-md h3 {
  font-size: 16px;
}

.answer-md h4 {
  font-size: 15px;
}

.answer-md p {
  margin: 0 0 12px;
  color: #3e5248;
  font-size: 15px;
  line-height: 1.9;
}

.answer-bullet {
  display: flex;
  gap: 0.45em;
}

.answer-bullet .marker {
  flex: none;
  color: var(--rust);
  font-weight: 700;
}

.answer-md hr {
  margin: 8px 0 16px;
  border: 0;
  border-top: 1px solid rgba(1, 124, 64, 0.16);
}

.answer-figure {
  margin: 0 0 14px;
}

.answer-figure :deep(.el-image) {
  max-width: 100%;
  border-radius: 10px;
  background: #fff;
}

.answer-figure figcaption {
  margin-top: 6px;
  color: #5c6f64;
  font-size: 12px;
  line-height: 1.5;
}

.answer-table-wrap {
  margin: 0 0 14px;
  overflow-x: auto;
}

.answer-md table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  font-size: 13px;
  line-height: 1.6;
}

.answer-md th,
.answer-md td {
  padding: 8px 10px;
  border: 1px solid rgba(1, 124, 64, 0.16);
  text-align: left;
  vertical-align: top;
}

.answer-md th {
  background: #e7f3ec;
  font-weight: 700;
}

.inline-citation {
  margin: 0 3px;
  padding: 1px 6px;
  border: 0;
  border-radius: 5px;
  background: rgba(190, 91, 50, 0.1);
  color: var(--rust);
  font-size: 11px;
  font-weight: 700;
  vertical-align: 1px;
  cursor: pointer;
}

.inline-citation:hover {
  background: var(--rust);
  color: #fff;
}
</style>
