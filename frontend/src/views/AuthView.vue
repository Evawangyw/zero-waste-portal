<script setup lang="ts">
// 登录 / 注册页（T05）：调 T02 的 /api/auth/register 与 /api/auth/login。
// 注册 = 五字段（姓名/机构/职业/关注议题/手机号）+ 密码 + 隐私勾选。
// 支持 ?redirect=xxx 登录成功后回跳（详情页下载未登录时带过来）。
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { authErrorCode, fieldIssues, login as apiLogin, register as apiRegister } from '../api/auth'
import { ApiError } from '../api/http'
import type { RegisterBody } from '../api/types'
import { CHEMICAL_TOTAL, ZERO_WASTE_TOTAL } from '../content/knowledge-overview'
import { TOPIC_OPTIONS } from '../constants'
import { setAuth } from '../composables/useAuth'
import { trackRegister } from '../composables/useTracking'

const route = useRoute()
const router = useRouter()

type TabName = 'login' | 'register'

function readTab(): TabName {
  const value = route.query['tab']
  const first = Array.isArray(value) ? value[0] : value
  return first === 'register' ? 'register' : 'login'
}

const activeTab = ref<TabName>(readTab())
const fromIntro = computed(() => route.query['from'] === 'intro')

const loginFormRef = ref<FormInstance>()
const registerFormRef = ref<FormInstance>()

const submitting = ref(false)
/** 后端返回的字段级错误（按字段名映射，逐字段标红） */
const fieldErrors = reactive<Record<string, string>>({})

const redirect = computed(() => {
  const value = route.query['redirect']
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first.startsWith('/') ? first : '/'
})

// ---------------------------------------------------------------- 登录表单

interface LoginFormModel {
  phone: string
  password: string
}

const loginForm = reactive<LoginFormModel>({ phone: '', password: '' })

const loginRules: FormRules<LoginFormModel> = {
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不对（11 位，1 开头）', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 64, message: '密码长度 8-64 位', trigger: 'blur' },
  ],
}

// ---------------------------------------------------------------- 注册表单

interface RegisterFormModel {
  name: string
  org: string
  occupation: string
  topics: string[]
  phone: string
  password: string
  confirmPassword: string
  consent: boolean
}

const registerForm = reactive<RegisterFormModel>({
  name: '',
  org: '',
  occupation: '',
  topics: [],
  phone: '',
  password: '',
  confirmPassword: '',
  consent: false,
})

const registerRules: FormRules<RegisterFormModel> = {
  name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { max: 40, message: '姓名不超过 40 字', trigger: 'blur' },
  ],
  org: [{ required: true, message: '请输入所属机构', trigger: 'blur' }],
  occupation: [{ required: true, message: '请输入职业', trigger: 'blur' }],
  topics: [
    {
      validator: (_rule, value: unknown, callback: (error?: Error) => void) => {
        if (Array.isArray(value) && value.length > 0) callback()
        else callback(new Error('请至少选一个关注议题'))
      },
      trigger: 'change',
    },
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不对（11 位，1 开头）', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 64, message: '密码长度 8-64 位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再输一次密码', trigger: 'blur' },
    {
      validator: (_rule, value: unknown, callback: (error?: Error) => void) => {
        if (value === registerForm.password) callback()
        else callback(new Error('两次输入的密码不一致'))
      },
      trigger: 'blur',
    },
  ],
  consent: [
    {
      validator: (_rule, value: unknown, callback: (error?: Error) => void) => {
        if (value === true) callback()
        else callback(new Error('请先勾选隐私提示'))
      },
      trigger: 'change',
    },
  ],
}

// ---------------------------------------------------------------- 提交

function clearFieldErrors(): void {
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key]
}

function applyFieldErrors(err: unknown): void {
  for (const issue of fieldIssues(err)) {
    fieldErrors[issue.field] = issue.message
  }
}

async function onLogin(): Promise<void> {
  const form = loginFormRef.value
  if (form === undefined) return
  const valid = await form.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  clearFieldErrors()
  try {
    const response = await apiLogin({
      phone: loginForm.phone.trim(),
      password: loginForm.password,
    })
    setAuth(response.token, response.user)
    ElMessage.success('登录成功')
    await router.push(redirect.value)
  } catch (err) {
    applyFieldErrors(err)
    if (authErrorCode(err) === 'INVALID_CREDENTIALS') {
      ElMessage.error('手机号或密码不对')
    } else {
      ElMessage.error(err instanceof ApiError ? err.message : '登录失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}

async function onRegister(): Promise<void> {
  const form = registerFormRef.value
  if (form === undefined) return
  const valid = await form.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  clearFieldErrors()
  try {
    // 注册成功后直接引导登录（后端 register 不返 token）
    const created = await apiRegister(toRegisterBody())
    // T07 埋点：注册成功事件（不记密码/手机号，只记维度与来源页）
    void trackRegister(created.user, readLandingPath())
    ElMessage.success('注册成功，请用刚注册的账号登录')
    loginForm.phone = registerForm.phone.trim()
    loginForm.password = ''
    activeTab.value = 'login'
  } catch (err) {
    applyFieldErrors(err)
    if (authErrorCode(err) === 'PHONE_TAKEN') {
      ElMessage.error('这个手机号已经注册过了，直接登录即可')
      activeTab.value = 'login'
    } else {
      ElMessage.error(err instanceof ApiError ? err.message : '注册失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}

function toRegisterBody(): RegisterBody {
  return {
    name: registerForm.name.trim(),
    org: registerForm.org.trim(),
    occupation: registerForm.occupation.trim(),
    topics: [...registerForm.topics],
    phone: registerForm.phone.trim(),
    password: registerForm.password,
    consent: true,
  }
}

/**
 * T07 埋点用：注册发生时的落地页路径。
 * 用户多半是从详情页「下载（需登录）」跳过来的，redirect 能还原这条来源。
 */
function readLandingPath(): string {
  const value = route.query['redirect']
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first.startsWith('/') ? first : route.path
}

function errorFor(field: string): string {
  return fieldErrors[field] ?? ''
}
</script>

<template>
  <div class="auth-page">
    <el-card shadow="never" class="auth-card">
      <h1 class="auth-title">登录 / 注册</h1>
      <p v-if="fromIntro" class="auth-sub">
        零废弃 {{ ZERO_WASTE_TOTAL }} 条，化学品 {{ CHEMICAL_TOTAL }} 条。注册后可以翻书架，也可以向 AI
        提问。
      </p>
      <p v-else class="auth-sub">登录后可以查看资料书架，并向 AI 提问。</p>

      <el-tabs v-model="activeTab">
        <!-- ------------------------------------------------------ 登录 -->
        <el-tab-pane label="登录" name="login">
          <el-form
            ref="loginFormRef"
            :model="loginForm"
            :rules="loginRules"
            label-width="90px"
            @submit.prevent="onLogin"
          >
            <el-form-item label="手机号" prop="phone" :error="errorFor('phone')">
              <el-input v-model="loginForm.phone" placeholder="11 位手机号" maxlength="11" />
            </el-form-item>
            <el-form-item label="密码" prop="password" :error="errorFor('password')">
              <el-input
                v-model="loginForm.password"
                type="password"
                placeholder="8-64 位"
                show-password
                @keyup.enter="onLogin"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="submitting" @click="onLogin">登录</el-button>
              <el-button @click="activeTab = 'register'">没有账号？去注册</el-button>
            </el-form-item>
          </el-form>
          <p class="tip">测试账号：13800000001 / Test1234</p>
        </el-tab-pane>

        <!-- ------------------------------------------------------ 注册 -->
        <el-tab-pane label="注册" name="register">
          <el-form
            ref="registerFormRef"
            :model="registerForm"
            :rules="registerRules"
            label-width="90px"
            @submit.prevent="onRegister"
          >
            <el-form-item label="姓名" prop="name" :error="errorFor('name')">
              <el-input v-model="registerForm.name" placeholder="你的姓名" maxlength="40" />
            </el-form-item>
            <el-form-item label="所属机构" prop="org" :error="errorFor('org')">
              <el-input v-model="registerForm.org" placeholder="社区 / 基金会 / 公司…" />
            </el-form-item>
            <el-form-item label="职业" prop="occupation" :error="errorFor('occupation')">
              <el-input v-model="registerForm.occupation" placeholder="如：社区工作者" />
            </el-form-item>
            <el-form-item label="关注议题" prop="topics" :error="errorFor('topics')">
              <el-select
                v-model="registerForm.topics"
                multiple
                placeholder="可多选"
                style="width: 100%"
              >
                <el-option
                  v-for="topic in TOPIC_OPTIONS"
                  :key="topic"
                  :label="topic"
                  :value="topic"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="手机号" prop="phone" :error="errorFor('phone')">
              <el-input v-model="registerForm.phone" placeholder="11 位手机号" maxlength="11" />
            </el-form-item>
            <el-form-item label="密码" prop="password" :error="errorFor('password')">
              <el-input
                v-model="registerForm.password"
                type="password"
                placeholder="8-64 位"
                show-password
              />
            </el-form-item>
            <el-form-item
              label="确认密码"
              prop="confirmPassword"
              :error="errorFor('confirmPassword')"
            >
              <el-input
                v-model="registerForm.confirmPassword"
                type="password"
                placeholder="再输一次"
                show-password
              />
            </el-form-item>
            <el-form-item prop="consent" :error="errorFor('consent')">
              <el-checkbox v-model="registerForm.consent">
                我已阅读并同意隐私提示：手机号仅用于账号登录与下载记录，不会对外公开
              </el-checkbox>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="submitting" @click="onRegister"
                >提交注册</el-button
              >
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
}

.auth-card {
  width: 100%;
  max-width: 640px;
}

.auth-title {
  margin: 0 0 6px;
  font-size: 22px;
}

.auth-sub {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}

.tip {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
