// 零废弃知识库 · 统一 ESLint 配置（flat config, ESLint 9）
// 覆盖 frontend(Vue3+TS) 与 backend(Express+TS strict)，禁 any 逃逸。
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      'backend/prisma/migrations/**',
      '**/*.d.ts',
    ],
  },

  // ---- 通用 JS 基础规则 ----
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },

  // ---- TypeScript 规则（frontend + backend 通用，无需类型信息）----
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,vue}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 铁律：禁止 any 逃逸
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-wrapper-object-types': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },

  // ---- 需要类型信息的强化规则（仅 .ts 文件；.vue 由 vue-tsc 兜底，避免解析器冲突）----
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
    },
  },

  // ---- Vue3 SFC 规则 ----
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: 'module' },
      globals: { ...globals.browser },
    },
    rules: {
      'vue/multi-word-component-names': 'error',
      'vue/no-v-html': 'error',
      'vue/require-default-prop': 'error',
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
    },
  },

  // ---- Prettier 收尾，避免格式规则双跑 ----
  prettier,
)
