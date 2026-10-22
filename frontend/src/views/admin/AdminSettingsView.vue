<script setup lang="ts">
// 系统设置：改问答用的向量模型、召回条数和百炼模型；按用户给予或撤销预览、下载、管理。
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ApiError } from '../../api/http'
import { fetchAdminSettings, saveAskSettings, updateUserAccess } from '../../api/settings'
import type { AskSettingsView, UserAccessRow } from '../../api/settings'
import { authToken, currentUser } from '../../composables/useAuth'

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const ask = ref<AskSettingsView | null>(null)
const users = ref<UserAccessRow[]>([])
const vectorIndexModel = ref<string | null>(null)
const vectorIndexMatches = ref(true)
const vectorModel = ref('')
const lexicalK = ref(80)
const vectorK = ref(80)
const fusedK = ref(40)
const bailianModel = ref('')
const bailianBaseUrl = ref('')
const bailianApiKey = ref('')
const busyUserId = ref('')

onMounted(() => {
  void load()
})

async function load(): Promise<void> {
  const token = authToken()
  if (token === null) return
  loading.value = true
  error.value = ''
  try {
    const page = await fetchAdminSettings(token)
    applyAsk(page.ask)
    users.value = [...page.users]
    vectorIndexModel.value = page.vectorIndexModel
    vectorIndexMatches.value = page.vectorIndexMatches
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '设置加载失败'
  } finally {
    loading.value = false
  }
}

function applyAsk(next: AskSettingsView): void {
  ask.value = next
  vectorModel.value = next.vectorModel
  lexicalK.value = next.lexicalK
  vectorK.value = next.vectorK
  fusedK.value = next.fusedK
  bailianModel.value = next.bailianModel
  bailianBaseUrl.value = next.bailianBaseUrl
  bailianApiKey.value = ''
}

async function onSaveAsk(): Promise<void> {
  const token = authToken()
  if (token === null || saving.value) return
  saving.value = true
  try {
    const page = await saveAskSettings(token, {
      vectorModel: vectorModel.value,
      lexicalK: lexicalK.value,
      vectorK: vectorK.value,
      fusedK: fusedK.value,
      bailianModel: bailianModel.value,
      bailianBaseUrl: bailianBaseUrl.value,
      bailianApiKey: bailianApiKey.value,
    })
    applyAsk(page.ask)
    vectorIndexModel.value = page.vectorIndexModel
    vectorIndexMatches.value = page.vectorIndexMatches
    ElMessage.success('问答设置已保存')
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function onToggle(
  row: UserAccessRow,
  field: 'canPreview' | 'canDownload' | 'isAdmin',
  value: boolean,
): Promise<void> {
  const token = authToken()
  if (token === null || busyUserId.value !== '') return
  const index = users.value.findIndex((item) => item.id === row.id)
  const previous = users.value[index]
  if (previous === undefined) return
  users.value[index] = { ...previous, [field]: value }
  busyUserId.value = row.id
  try {
    const saved = await updateUserAccess(token, row.id, { [field]: value })
    users.value[index] = saved.user
    ElMessage.success('权限已更新')
  } catch (err) {
    users.value[index] = previous
    ElMessage.error(err instanceof ApiError ? err.message : '更新失败')
  } finally {
    busyUserId.value = ''
  }
}

function isSelf(row: UserAccessRow): boolean {
  return currentUser.value?.id === row.id
}
</script>

<template>
  <div class="settings-page">
    <header>
      <h2>系统设置</h2>
      <p>问答里用到的是向量模型、召回条数和百炼。解析文档的 SoMark 不参与回答。</p>
    </header>

    <el-alert v-if="error !== ''" type="error" :closable="false" :title="error" />
    <p v-else-if="loading">正在读取设置…</p>

    <section v-if="ask !== null">
      <h3>问答</h3>
      <el-form label-position="top">
        <el-form-item label="向量模型">
          <el-select v-model="vectorModel" style="width: 100%">
            <el-option v-for="model in ask.installedVectorModels" :key="model" :label="model" :value="model" />
          </el-select>
          <p class="hint">服务器上装了哪些，这里才能选哪些。改成另一套后，旧的向量索引不会自动重做，向量召回会先停用。</p>
          <p v-if="!vectorIndexMatches" class="hint warn">
            现有索引是 {{ vectorIndexModel ?? '空的' }}，和当前选择不一致，提问暂时只用词法召回。
          </p>
        </el-form-item>
        <div class="k-row">
          <el-form-item label="词法召回条数">
            <el-input-number v-model="lexicalK" :min="1" :max="200" :step="1" />
          </el-form-item>
          <el-form-item label="向量召回条数">
            <el-input-number v-model="vectorK" :min="1" :max="200" :step="1" />
          </el-form-item>
          <el-form-item label="融合后保留">
            <el-input-number v-model="fusedK" :min="1" :max="200" :step="1" />
          </el-form-item>
        </div>
        <p class="hint">召回不是另一个模型。词法是关键词，向量是上面的模型，两边按名次融合成交给百炼的片段。</p>
        <el-form-item label="百炼模型">
          <el-input v-model="bailianModel" maxlength="80" />
        </el-form-item>
        <el-form-item label="百炼接口地址">
          <el-input v-model="bailianBaseUrl" maxlength="200" />
        </el-form-item>
        <el-form-item :label="ask.bailianKeySet ? '百炼密钥（已配置，留空则不修改）' : '百炼密钥'">
          <el-input v-model="bailianApiKey" type="password" show-password placeholder="不修改就留空" />
        </el-form-item>
        <el-button type="primary" :loading="saving" @click="onSaveAsk">保存问答设置</el-button>
      </el-form>
    </section>

    <section>
      <h3>用户权限</h3>
      <p class="hint">未登录的人仍然不能预览、下载或进入管理页。下面是给已注册用户开关这三项。管理员始终可以预览和下载。不能取消自己的管理权限。</p>
      <el-table :data="users" row-key="id" size="small" empty-text="还没有注册用户">
        <el-table-column prop="name" label="姓名" min-width="100" />
        <el-table-column prop="phone" label="手机号" min-width="130" />
        <el-table-column prop="org" label="机构" min-width="140" />
        <el-table-column label="预览" width="80">
          <template #default="{ row }">
            <el-switch
              :model-value="row.canPreview"
              :disabled="busyUserId === row.id || row.isAdmin"
              :aria-label="`${row.name}的预览`"
              @change="onToggle(row, 'canPreview', Boolean($event))"
            />
          </template>
        </el-table-column>
        <el-table-column label="下载" width="80">
          <template #default="{ row }">
            <el-switch
              :model-value="row.canDownload"
              :disabled="busyUserId === row.id || row.isAdmin"
              :aria-label="`${row.name}的下载`"
              @change="onToggle(row, 'canDownload', Boolean($event))"
            />
          </template>
        </el-table-column>
        <el-table-column label="管理" width="80">
          <template #default="{ row }">
            <el-switch
              :model-value="row.isAdmin"
              :disabled="busyUserId === row.id || isSelf(row)"
              :aria-label="`${row.name}的管理`"
              @change="onToggle(row, 'isAdmin', Boolean($event))"
            />
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

header h2,
section h3 {
  margin: 0 0 8px;
  color: var(--forest-deep);
  font-family: var(--serif);
}

header h2 {
  font-size: 26px;
}

section {
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
}

.hint {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

.hint.warn {
  color: var(--rust);
}

.k-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
}

header p {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}
</style>
