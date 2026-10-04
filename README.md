# 零废弃知识库 · 公众端 monorepo

WeKnora v0.8.2 作内网问答引擎，本仓库是自建公众网站（前端 + 后端）。

- 前端：Vue 3 + Vite + TypeScript + Element Plus → `frontend/`
- 后端：Node.js + Express（TypeScript strict）+ Prisma + SQLite → `backend/`
- 部署：Docker Compose + Nginx（仅本项目两服务，**不含** WeKnora）→ `deploy/`

## 环境要求

- Node.js >= 20（本机实测 v24.14.0）
- npm >= 10（`pnpm` 可用亦可，脚本一一对应）

## 快速开始

```bash
npm install                     # 根目录一次装齐（workspaces）

npm run dev:backend             # 后端 http://localhost:4000
npm run dev:frontend            # 前端 http://localhost:5173
```

验收：

```bash
curl http://localhost:4000/health     # => {"ok":true}
curl http://localhost:5173            # => 占位页 HTML（标题「零废弃知识库」）
```

## 质量关

```bash
npm run lint            # ESLint（TS + Vue3），要求 0 error 0 warning
npm run typecheck       # backend: tsc --noEmit / frontend: vue-tsc --noEmit
npm run format:check    # Prettier 校验
npm run verify          # 上面三条一起跑
npm run prisma:generate # 生成 Prisma Client
```

## 目录

```
zero-waste-portal/
├─ frontend/          # 公众端（占位页 → T02 起接真实路由）
├─ backend/           # 自有后端（/health → T01 起接 WeKnora 对接层）
│  └─ src/modules/    # 每个模块一个目录，index.ts 是唯一对外出口
├─ deploy/            # docker-compose.yml / Dockerfile / nginx.conf / .env.example
├─ docs/              # 任务卡与验收记录
└─ AGENTS.md          # 执行方必读（三铁律）
```

## 密钥管理

真实密钥**只**写进 `backend/.env`（已 gitignore），结构见 `deploy/.env.example`。
任何 key / 密码 / token 不得进代码、进 git、进文档。

## 当前进度

| 任务卡 | 状态 |
| --- | --- |
| T00 工程脚手架 | ✅ 完成（见 `docs/验收记录/T00-验收记录.md`） |