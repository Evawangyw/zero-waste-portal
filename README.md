# 零废弃知识库 · Zero Waste Knowledge Base

[中文](#中文) | [English](#english)

## 中文

欢迎来到零废弃知识库！

无论你是刚开始了解零废弃，还是正在为社区活动、日常实践或研究寻找资料，都欢迎来这里看看。希望这个知识库能帮你找到需要的信息，也为下一步行动带来一点灵感。

你可以在资料书架中浏览感兴趣的主题，登录后预览或下载原文件。有问题时，也可以问问 AI 助手，再点击回答中的引用查看资料来源。

下面介绍网站的功能，以及如何在本地运行、管理资料和部署网站，方便参与维护与开发的伙伴使用。

### 主要功能

- **资料书架**：按知识领域浏览资料，搜索发布机构，按年份和资料类型筛选，每页显示 20 本。
- **资料阅读**：登录后查看资料详情，预览或下载原文件。
- **AI 问答**：从本地语料库查找相关内容，再调用百炼模型生成带引用的回答。未找到依据时，提示资料不足。回答支持 Markdown，引用编号可点击查看来源，侧栏保留对话历史。
- **后台管理**：管理员可以上传资料、上架或下架资料，查看资料数量、访问情况，以及注册用户的岗位、领域和所属机构统计。

### 技术栈

| 部分 | 技术 | 目录 |
| --- | --- | --- |
| 前端 | Vue 3、Vite、TypeScript、Element Plus | `frontend/` |
| 后端 | Node.js、Express、TypeScript（strict）、Prisma、SQLite | `backend/` |
| 部署 | Docker Compose、Nginx | `deploy/` |

### 本地运行

需要 Node.js 20 或更新版本，以及 npm 10 或更新版本。以下命令从项目根目录运行；需要切换目录的地方会单独说明。

**1. 安装依赖**

```sh
npm install
```

**2. 创建配置文件**

首次配置时，将示例文件复制为 `backend/.env`。

macOS / Linux：

```sh
cp deploy/.env.example backend/.env
```

Windows PowerShell：

```powershell
Copy-Item deploy/.env.example backend/.env
```

在 `backend/.env` 中设置自己的 `JWT_SECRET`，将 `DB_URL` 保持为 `file:../data/app.db`。真实密钥保存在此文件中，不提交到 Git。

AI 问答所需的语料库、百炼配置，以及文档转换所需的 SoMark 配置，见下方“资料导入与 AI 问答”和“环境变量”。

**3. 初始化数据库**

```sh
npm run prisma:generate
npm run prisma:push --workspace backend
```

已有语料库时，将语料同步到书架：

```sh
npm run sync:corpus --workspace backend
```

**4. 启动服务**

打开两个终端，分别运行：

```sh
npm run dev:backend
```

```sh
npm run dev:frontend
```

前端地址为 <http://localhost:5173>，后端地址为 <http://localhost:4000>。

**5. 检查服务**

macOS / Linux：

```sh
curl http://localhost:4000/health
curl http://localhost:5173
```

Windows PowerShell：

```powershell
curl.exe http://localhost:4000/health
curl.exe http://localhost:5173
```

**设置管理员**

将示例手机号替换为已注册账号的手机号：

```sh
npm run admin:promote --workspace backend -- 13800000000
```

省略手机号时，命令会列出当前管理员。

### 页面与访问权限

未登录用户先看到开场介绍。登录后可访问知识库介绍、资料书架和 AI 助手。

| 路径 | 访问权限 | 内容 |
| --- | --- | --- |
| `/intro` | 未登录用户 | 开场介绍 |
| `/` | 已登录用户 | 知识库介绍、基金会简介、机构官网和合作方式 |
| `/shelf` | 所有人 | 资料浏览、搜索和筛选 |
| `/ask` | 已登录用户 | AI 问答与对话历史 |
| `/auth` | 所有人 | 登录与注册 |
| `/doc/:id` | 已登录用户 | 资料详情、预览和下载；未登录时跳转至登录页 |
| `/admin/stats` | 管理员 | 资料管理与使用统计 |

书架搜索没有结果时，可点击“试试问 AI”，将搜索内容带入 AI 助手。

### 资料导入与 AI 问答

**问答流程**

AI 助手结合关键词检索和向量检索，从本地语料库中查找相关段落，提取可引用的原文，再调用百炼模型生成回答。资料预览和下载直接读取本地原文件。

书架索引保存资料信息，问答使用的正文保存在语料库的文本片段中。本地运行时，将 `ASK_CORPUS_DB` 指向 `backend/data/corpus/data/app.db`。

知识领域沿用资料表中的完整名称。例如，“食物/有机废弃物”是一个领域名称，斜杠不会将其拆分为两个领域。

**管理员上传**

管理员可在“管理统计”页面上传 PDF、Word 或 Excel 文件。原文件保存到 `backend/data/uploads`。

- 配置 `SOMARK_API_KEY` 后，系统调用 SoMark 将文件转为 Markdown，写入语料库，供书架和 AI 问答使用。
- 大于 30 MB 的文件通过异步任务处理。
- 未配置密钥时，系统只登记资料，不调用转换接口。
- 转换失败时，书架保留原文件，AI 问答暂不使用该文件的内容。

**批量转换 PDF**

以下命令转换指定目录中的 PDF，再同步书架。将 `<PDF_DIRECTORY>` 替换为 PDF 文件夹路径，将 `<SOMARK_API_KEY>` 替换为自己的密钥。

macOS / Linux：

```sh
cd backend
SOMARK_API_KEY='<SOMARK_API_KEY>' node scripts/convert-chemicals.mjs '<PDF_DIRECTORY>'
cd ..
npm run sync:corpus --workspace backend
```

Windows PowerShell：

```powershell
cd backend
$env:SOMARK_API_KEY = '<SOMARK_API_KEY>'
node scripts/convert-chemicals.mjs '<PDF_DIRECTORY>'
cd ..
npm run sync:corpus --workspace backend
```

脚本按文件名跳过已完成的文件，避免重复转换和计费。使用多个 SoMark 密钥时，以分号或逗号分隔，写入同一个 `SOMARK_API_KEY` 变量；当前密钥额度用完后切换到下一个。

### 环境变量

配置示例见 `deploy/.env.example`。下表说明变量用途，真实值保存在 `backend/.env` 中。

| 变量 | 用途 |
| --- | --- |
| `PORT` | 后端端口，默认 `4000` |
| `JWT_SECRET` | 登录令牌的签名密钥 |
| `DB_URL` | 应用 SQLite 数据库连接地址；本地使用 `file:../data/app.db`，对应 `backend/data/app.db` |
| `ASK_CORPUS_DB` | 问答语料数据库路径；本地指向 `backend/data/corpus/data/app.db` |
| `ASK_PDF_ROOTS` | 查找原文件的目录列表，按文件名匹配，以冒号分隔；未设置时扫描 `inputs/`，并包含管理员上传目录 |
| `BAILIAN_API_KEY` | 百炼 API 密钥 |
| `BAILIAN_BASE_URL` | 百炼 API 地址 |
| `BAILIAN_MODEL` | 百炼模型名称 |
| `ADMIN_STATS_TOKEN` | 管理统计接口的静态访问口令；未设置时使用管理员登录验证 |
| `SOMARK_API_KEY` | 上传和批量转换使用的 SoMark 密钥；多个密钥以分号或逗号分隔 |

### 项目结构

```text
zero-waste-portal/
├─ frontend/src/
│  ├─ views/           # 页面
│  ├─ components/      # 导航、统计图、回答展示
│  ├─ api/             # 后端请求与类型定义
│  ├─ composables/     # 登录状态、用户行为记录
│  └─ content/         # 介绍页与基金会文案
├─ backend/src/
│  ├─ app.ts           # 注册路由
│  └─ modules/         # 后端功能模块
├─ backend/prisma/     # SQLite 数据表结构
├─ backend/data/       # 账号、书架、对话和上传文件，不提交到 Git
│  └─ corpus/          # 问答语料：data/app.db、storage/markdown
├─ backend/scripts/    # PDF 批量转换脚本
├─ deploy/             # Docker Compose、Dockerfile、Nginx、配置示例
├─ demo/               # 无需启动服务的静态演示
├─ docs/               # 任务卡、验收记录、对外方案
├─ scripts/data01/     # 一次性书架数据整理脚本
├─ inputs/             # 本地原始 PDF 与导入批次，不提交到 Git
└─ AGENTS.md           # 代码修改约定
```

`backend/src/modules/` 按功能划分模块，每个模块通过 `index.ts` 对外提供接口。

| 模块 | 职责 |
| --- | --- |
| `health` | 提供 `GET /health` 健康检查 |
| `auth` | 注册、登录和 `/api/auth/me` 用户信息接口 |
| `docs` | 书架、资料详情、预览、下载，以及管理员上传后的 SoMark 转换与保存 |
| `ask` | 本地检索、原文提取、百炼回答生成和对话历史 |
| `track` | 用户行为记录和管理统计 |
| `ingest` | 按映射表匹配 Excel 元数据与 PDF 文件 |

### 服务器部署与更新

服务器上的语料目录为 `/root/shelf-corpus`，其中包含 `data/app.db` 和 `storage/markdown`。原始 PDF 存放在 `/root/pdfs`。

保留服务器现有的环境配置，不要用本地 `backend/.env` 覆盖。更新代码后，重新构建服务并同步书架：

```sh
git pull
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec backend node backend/dist/modules/docs/docs.corpus.sync.cli.js
```

`up -d --build` 更新前端和后端；最后一条命令将语料同步到书架索引，保留已注册账号。站点入口为容器的 `8080` 端口。

### 代码检查

```sh
npm run lint
npm run typecheck
npm run format:check
npm run verify
```

后端各模块的测试命令见 `backend/package.json` 中的 `test:*` 脚本。

---

## English

Welcome to the Zero Waste Knowledge Base!

Whether you’re new to zero waste or looking for resources for a community event, an everyday project, or research, we’re glad you’re here. We hope this collection helps you find useful information and a little inspiration for your next step.

Browse the document shelf to explore topics that interest you, then sign in to preview or download the original files. Have a question? Ask the AI assistant and follow the citations in its answer to read the sources.

For everyone helping maintain or develop the website, the sections below explain its features, local setup, document management, and deployment.

### Features

- **Document shelf**: Browse by knowledge area, search publishing organizations, and filter by year and document type. Each page shows 20 documents.
- **Document access**: Sign in to view document details, preview files, and download originals.
- **AI assistant**: Searches the local corpus, then uses a Bailian model to generate answers with citations. When supporting material is unavailable, it reports that the corpus lacks sufficient information. Answers support Markdown, citations link to sources, and the sidebar keeps conversation history.
- **Admin tools**: Upload, publish, or unpublish documents. View document counts, site usage, and registered users' roles, fields, and organizations.

### Tech stack

| Part | Technologies | Directory |
| --- | --- | --- |
| Frontend | Vue 3, Vite, TypeScript, Element Plus | `frontend/` |
| Backend | Node.js, Express, TypeScript (strict), Prisma, SQLite | `backend/` |
| Deployment | Docker Compose, Nginx | `deploy/` |

### Run locally

Requires Node.js 20 or later and npm 10 or later. Run commands from the project root unless a directory change is shown.

**1. Install dependencies**

```sh
npm install
```

**2. Create the configuration file**

For the first setup, copy the example to `backend/.env`.

macOS / Linux:

```sh
cp deploy/.env.example backend/.env
```

Windows PowerShell:

```powershell
Copy-Item deploy/.env.example backend/.env
```

Set your own `JWT_SECRET` in `backend/.env`. Keep `DB_URL` as `file:../data/app.db`. Store real credentials in this file and keep it out of Git.

For the corpus and Bailian settings needed by the AI assistant, and the SoMark settings needed for document conversion, see “Document import and AI answers” and “Environment variables” below.

**3. Initialize the database**

```sh
npm run prisma:generate
npm run prisma:push --workspace backend
```

If you already have a corpus, sync its documents to the shelf:

```sh
npm run sync:corpus --workspace backend
```

**4. Start the services**

Open two terminals and run one command in each:

```sh
npm run dev:backend
```

```sh
npm run dev:frontend
```

The frontend runs at <http://localhost:5173> and the backend at <http://localhost:4000>.

**5. Check the services**

macOS / Linux:

```sh
curl http://localhost:4000/health
curl http://localhost:5173
```

Windows PowerShell:

```powershell
curl.exe http://localhost:4000/health
curl.exe http://localhost:5173
```

**Grant admin access**

Replace the example phone number with the number of a registered account:

```sh
npm run admin:promote --workspace backend -- 13800000000
```

Run the command without a phone number to list current administrators.

### Pages and access

Signed-out visitors first see the introduction. After signing in, users can access the knowledge base overview, document shelf, and AI assistant.

| Route | Access | Content |
| --- | --- | --- |
| `/intro` | Signed-out visitors | Introduction |
| `/` | Signed-in users | Knowledge base overview, foundation information, official website, and collaboration options |
| `/shelf` | Everyone | Document browsing, search, and filters |
| `/ask` | Signed-in users | AI assistant and conversation history |
| `/auth` | Everyone | Sign-in and registration |
| `/doc/:id` | Signed-in users | Document details, preview, and download; signed-out visitors are redirected to sign-in |
| `/admin/stats` | Administrators | Document management and usage statistics |

When a shelf search returns no results, “Try asking AI” sends the search text to the assistant.

### Document import and AI answers

**How answers are generated**

The assistant combines keyword and vector search to find relevant passages in the local corpus. It extracts source text, then calls a Bailian model to generate an answer. Document previews and downloads read the original local files.

The shelf index stores document information. The corpus stores the text chunks used for AI answers. For local development, point `ASK_CORPUS_DB` to `backend/data/corpus/data/app.db`.

Knowledge areas retain their full names from the document table. For example, `食物/有机废弃物` (“Food / Organic Waste”) is one area; the slash does not split it into two.

**Admin uploads**

Administrators can upload PDF, Word, or Excel files from the admin statistics page. Original files are saved to `backend/data/uploads`.

- With `SOMARK_API_KEY` configured, SoMark converts files to Markdown and adds them to the corpus for use by the shelf and AI assistant.
- Files larger than 30 MB are processed asynchronously.
- Without a key, the system registers the document without calling the conversion API.
- If conversion fails, the original file remains on the shelf, and its contents are unavailable to the AI assistant.

**Batch PDF conversion**

Convert PDFs in a directory, then sync the shelf. Replace `<PDF_DIRECTORY>` with the folder path and `<SOMARK_API_KEY>` with your key.

macOS / Linux:

```sh
cd backend
SOMARK_API_KEY='<SOMARK_API_KEY>' node scripts/convert-chemicals.mjs '<PDF_DIRECTORY>'
cd ..
npm run sync:corpus --workspace backend
```

Windows PowerShell:

```powershell
cd backend
$env:SOMARK_API_KEY = '<SOMARK_API_KEY>'
node scripts/convert-chemicals.mjs '<PDF_DIRECTORY>'
cd ..
npm run sync:corpus --workspace backend
```

The script skips completed files by filename to avoid repeat conversions and charges. To use multiple SoMark keys, separate them with semicolons or commas in `SOMARK_API_KEY`. The script switches to the next key when the current key's quota is exhausted.

### Environment variables

See `deploy/.env.example` for sample configuration. Store real values in `backend/.env`.

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend port; defaults to `4000` |
| `JWT_SECRET` | Signing key for authentication tokens |
| `DB_URL` | Application SQLite connection URL; locally, use `file:../data/app.db`, which points to `backend/data/app.db` |
| `ASK_CORPUS_DB` | Corpus database path; locally, `backend/data/corpus/data/app.db` |
| `ASK_PDF_ROOTS` | Colon-separated directories for locating original files by filename; defaults to scanning `inputs/` and includes the admin upload directory |
| `BAILIAN_API_KEY` | Bailian API key |
| `BAILIAN_BASE_URL` | Bailian API endpoint |
| `BAILIAN_MODEL` | Bailian model name |
| `ADMIN_STATS_TOKEN` | Static access token for admin statistics; when unset, access uses admin sign-in |
| `SOMARK_API_KEY` | SoMark key for uploads and batch conversion; separate multiple keys with semicolons or commas |

### Project structure

```text
zero-waste-portal/
├─ frontend/src/
│  ├─ views/           # Pages
│  ├─ components/      # Navigation, charts, answer display
│  ├─ api/             # Backend requests and type definitions
│  ├─ composables/     # Authentication state and activity tracking
│  └─ content/         # Introduction and foundation copy
├─ backend/src/
│  ├─ app.ts           # Route registration
│  └─ modules/         # Backend feature modules
├─ backend/prisma/     # SQLite schema
├─ backend/data/       # Accounts, shelf, chats, uploads; excluded from Git
│  └─ corpus/          # AI corpus: data/app.db, storage/markdown
├─ backend/scripts/    # Batch PDF conversion scripts
├─ deploy/             # Docker Compose, Dockerfile, Nginx, example config
├─ demo/               # Static demo that runs without services
├─ docs/               # Task cards, acceptance records, external proposals
├─ scripts/data01/     # One-time shelf data preparation scripts
├─ inputs/             # Local source PDFs and import batches; excluded from Git
└─ AGENTS.md           # Code editing guidelines
```

Each directory under `backend/src/modules/` contains a feature module, with `index.ts` as its public entry point.

| Module | Responsibility |
| --- | --- |
| `health` | `GET /health` health check |
| `auth` | Registration, sign-in, and `/api/auth/me` user information |
| `docs` | Shelf, document details, preview, download, and SoMark conversion and storage for admin uploads |
| `ask` | Local search, source extraction, Bailian answer generation, and conversation history |
| `track` | Activity tracking and admin statistics |
| `ingest` | Matching Excel metadata to PDF files using a mapping table |

### Server deployment and updates

Store the corpus on the host at `/root/shelf-corpus`, containing `data/app.db` and `storage/markdown`. Store original PDFs at `/root/pdfs`.

Keep the server's existing environment configuration; do not overwrite it with your local `backend/.env`. Pull the latest code, rebuild the services, and sync the shelf:

```sh
git pull
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec backend node backend/dist/modules/docs/docs.corpus.sync.cli.js
```

`up -d --build` updates the frontend and backend. The final command syncs the corpus to the shelf index while preserving registered accounts. The site entry point is the container's port `8080`.

### Code checks

```sh
npm run lint
npm run typecheck
npm run format:check
npm run verify
```

Backend module tests are available as `test:*` scripts in `backend/package.json`.
