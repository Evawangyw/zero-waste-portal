# 零废弃知识库

公众网站。未登录先看开场介绍。登录后依次是关于零废弃知识库、资料书架、AI 助手。

AI 助手先在本机检索：词法和向量一起召回，抽出能引用的原文，再用百炼按这些原文生成回答。库里没有依据时直接说明，不编造。回答按 Markdown 排版，句中编号可以点开来源。资料预览和下载读本机文件。

- 前端：Vue 3 + Vite + TypeScript + Element Plus → `frontend/`
- 后端：Node.js + Express（TypeScript strict）+ Prisma + SQLite → `backend/`
- 部署：Docker Compose + Nginx → `deploy/`

## 页面

| 路径 | 谁能看 | 做什么 |
| --- | --- | --- |
| `/intro` | 未登录 | 开场介绍 |
| `/` | 已登录 | 关于零废弃知识库：基金会简介、机构官网和合作方式 |
| `/shelf` | 所有人 | 资料书架。先选一个知识领域，发布机构可输入搜索，再按年份、类型整架翻页，每页 20 本 |
| `/ask` | 已登录 | AI 助手，侧栏保留历史 |
| `/auth` | 所有人 | 登录 / 注册 |
| `/doc/:id` | 已登录 | 资料详情、预览、下载。未登录点开会去登录页 |
| `/admin/stats` | 管理员 | 库规模、访问、注册用户的岗位、领域和所属机构。可上传资料、上架和下架 |

书架没有结果时，「试试问 AI」会带着这句话去 AI 助手。

## 后端模块

`backend/src/modules/` 里每个目录一个模块，`index.ts` 是对外出口。

| 模块 | 职责 |
| --- | --- |
| `health` | `GET /health` |
| `auth` | 注册、登录、`/api/auth/me` |
| `docs` | 书架、资料详情、预览、下载。管理员上传后用 SoMark 转成 Markdown 并入库 |
| `ask` | 本机检索，抽出原文后用百炼生成回答，以及对话历史 |
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
├─ backend/data/      # 账号、书架、对话、上传原文；不进 git
├─ backend/data/corpus/ # 问答语料：data/app.db 与 storage/markdown；不进 git
├─ backend/scripts/   # 批量把 PDF 转进语料库
├─ deploy/            # compose、Dockerfile、nginx、.env.example
├─ demo/              # 不启动服务也能打开的静态演示
├─ docs/              # 任务卡、验收记录、对外方案
├─ scripts/data01/    # 一次性的书架数据整理脚本
├─ inputs/            # 本机原始 PDF 与导入批次，不进 git
└─ AGENTS.md          # 改代码前的约定
```

问答正文不在书架索引里，而在语料库的切片中。本机把 `ASK_CORPUS_DB` 指到 `backend/data/corpus/data/app.db`。知识领域用资料表里的原值，例如「食物/有机废弃物」；斜杠是名称的一部分，不会拆成两个领域。

管理员在「管理统计」上传 PDF、Word 或 Excel。文件先落在 `backend/data/uploads`。配了 `SOMARK_API_KEY` 后，SoMark 把原文转成 Markdown，写入语料库，书架和问答都能用。超过 30MB 走异步任务。没有密钥时只登记，不调用接口。转换失败时原文仍留在书架，但不会进入问答。

批量续转某一目录里的 PDF：

```bash
cd backend
SOMARK_API_KEY=... node scripts/convert-chemicals.mjs "<pdf目录>"
cd ..
npm run sync:corpus --workspace backend
```

已完成的文件按文件名跳过，不会重复扣费。多把密钥写在同一个变量里，用分号或逗号隔开。

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
| `ASK_CORPUS_DB` | 问答语料库。本机为 `backend/data/corpus/data/app.db` |
| `ASK_PDF_ROOTS` | 按文件名找原文的目录，冒号分隔。未设置时扫 `inputs/`，并加上管理员上传目录 |
| `BAILIAN_API_KEY` | 百炼密钥。只放在 `backend/.env` |
| `BAILIAN_BASE_URL` | 百炼接口地址 |
| `BAILIAN_MODEL` | 百炼模型名 |
| `ADMIN_STATS_TOKEN` | 管理统计的静态口令；不设则只认管理员登录 |
| `SOMARK_API_KEY` | 上传和批量转换用的 SoMark 密钥。多把用分号或逗号隔开，额度用完换下一把 |

## 部署

服务器上拉最新代码后重新构建。不要用本机的 `backend/.env` 覆盖服务器上的文件。

语料放在宿主机 `/root/shelf-corpus`，里面要有 `data/app.db` 和 `storage/markdown`。原文 PDF 放在 `/root/pdfs`。

```bash
git pull
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec backend node backend/dist/modules/docs/docs.corpus.sync.cli.js
```

前一条命令更新页面和接口。后一条把语料同步进书架索引，不覆盖已注册账号。站点入口是容器的 8080 端口。

## 质量关

```bash
npm run lint
npm run typecheck
npm run format:check
npm run verify
```

后端自测在 `backend/package.json` 的 `test:*` 脚本里，按模块单独跑。
