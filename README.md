# 零废弃知识库

公众网站。未登录先看知识库介绍；登录后可以翻书架、打开资料，并在首页向知识库提问。

首页问答在本机完成：词法检索和向量检索一起召回，再从原文抽出句子。回答按 Markdown 排版，句中编号可以点开来源。资料预览和下载读本机文件。

- 前端：Vue 3 + Vite + TypeScript + Element Plus → `frontend/`
- 后端：Node.js + Express（TypeScript strict）+ Prisma + SQLite → `backend/`
- 部署：Docker Compose + Nginx → `deploy/`

## 页面

| 路径 | 谁能看 | 做什么 |
| --- | --- | --- |
| `/intro` | 未登录 | 知识库介绍 |
| `/` | 已登录 | 首页问答，侧栏保留历史 |
| `/auth` | 所有人 | 登录 / 注册 |
| `/shelf` | 所有人 | 资料书架。先选一个主题，发布机构可输入搜索，再按年份、类型整架翻页，每页 20 本 |
| `/doc/:id` | 已登录 | 资料详情、预览、下载。未登录点开会去登录页 |
| `/foundation` | 已登录 | 基金会介绍 |
| `/admin/stats` | 管理员 | 库规模、访问，以及注册用户的岗位、领域和所属机构 |

书架没有结果时，「试试问 AI」会带着这句话回到首页。

## 后端模块

`backend/src/modules/` 里每个目录一个模块，`index.ts` 是对外出口。

| 模块 | 职责 |
| --- | --- |
| `health` | `GET /health` |
| `auth` | 注册、登录、`/api/auth/me` |
| `docs` | 书架、资料详情、预览、下载、管理员上传 |
| `ask` | 本机检索与抽取式回答，以及对话历史 |
| `track` | 行为埋点、管理统计 |
| `ingest` | 按映射表把 Excel 元数据配上 PDF |

## 目录

```
zero-waste-portal/
├─ frontend/src/
│  ├─ views/          # 页面
│  ├─ components/     # 导航、统计图、回答排版
│  ├─ api/            # 调后端的类型和请求
│  ├─ composables/    # 登录态、埋点
│  └─ content/        # 介绍页和基金会文案
├─ backend/src/
│  ├─ app.ts          # 挂路由
│  └─ modules/        # 见上表
├─ backend/prisma/    # SQLite 表结构
├─ backend/data/      # 账号、书架、对话、统计；不进 git
├─ deploy/            # compose、Dockerfile、nginx、.env.example
├─ demo/              # 不启动服务也能打开的静态演示
├─ docs/              # 任务卡、验收记录、对外方案
├─ scripts/data01/    # 一次性的书架数据整理脚本
├─ inputs/            # 本机原始 PDF 与导入批次，不进 git
└─ AGENTS.md          # 改代码前的约定
```

问答正文不在书架索引里。默认同读一份带切片的语料库，路径用 `ASK_CORPUS_DB` 指定。

## 环境要求

- Node.js >= 20
- npm >= 10

## 快速开始

```bash
npm install

npm run dev:backend             # http://localhost:4000
npm run dev:frontend            # http://localhost:5173
```

```bash
curl http://localhost:4000/health
curl http://localhost:5173
```

第一次在一台机器上跑，先备好 `backend/.env`，再把表建出来。真实密钥只写进这个文件。

```bash
cp deploy/.env.example backend/.env
npm run prisma:generate
npm run prisma:push --workspace backend
```

`.env` 里至少要换 `JWT_SECRET`。`DB_URL` 保持 `file:../data/app.db`。

把语料同步进书架：

```bash
npm run sync:corpus --workspace backend
```

把某个已注册手机号提成管理员。不带手机号时，只列出当前管理员：

```bash
npm run admin:promote --workspace backend -- 13800000000
```

## 配置

只记变量名，不记值。样例在 `deploy/.env.example`。

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端端口，默认 4000 |
| `JWT_SECRET` | 登录令牌签名 |
| `DB_URL` | 自建 SQLite，落到 `backend/data/app.db` |
| `ASK_CORPUS_DB` | 问答用的语料库路径 |
| `ADMIN_STATS_TOKEN` | 管理统计的静态口令；不设则只认管理员登录 |
| `SOMARK_API_KEY` | 管理员上传后的转换任务。目前只登记，尚未调用接口 |

## 质量关

```bash
npm run lint
npm run typecheck
npm run format:check
npm run verify
```

后端自测在 `backend/package.json` 的 `test:*` 脚本里，按模块单独跑。
