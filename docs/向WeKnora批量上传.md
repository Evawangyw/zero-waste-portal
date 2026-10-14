# 向 WeKnora 批量上传

这份说明给接下来继续灌库的人。目标是把「零废弃知识库」附件包里的文件，按 Excel 上的四个标签送进本机 WeKnora，每次 10 份。

上传目标只有这一个知识库，不要新建别的库，也不要传到测试库：

```text
28c5553a-5890-434c-8bba-0c279489264c
```

`backend/.env` 里的 `WEKNORA_KB_ID` 必须是这一串。导入命令的 `--kb` 也写这一串。2026-10-09 的第一批已经进了这个库。

WeKnora 是问答引擎，版本固定 **v0.8.2**。它不在本仓库里，也不要改它的源代码。本仓库只负责网站，以及下面这条导入命令。

网站本身怎么把代码跑起来，看 `docs/协作者本机配置说明.md`。本文从 WeKnora 装好开始，接到「文件进库、标签能读回来」。

## 1. 安装 WeKnora

需要 Docker Desktop 已经打开，菜单栏鲸鱼图标稳定。苹果芯片的 Mac 如果弹出 Rosetta 安装失败，点 Disable Rosetta，不要反复 Retry。

在一个和本仓库分开的文件夹里：

```bash
git clone --branch v0.8.2 --depth 1 https://github.com/Tencent/WeKnora.git
cd WeKnora
```

把 `.env.example` 复制成 `.env`。确认这两行后面不是空的：

```bash
SYSTEM_SIGNING_KEY=一串随机字符
SYSTEM_AES_KEY=另一串随机字符
```

可以各生成一次再贴进去。生成之后不要再改，否则已经发出的嵌入令牌会失效。

```bash
openssl rand -hex 32
openssl rand -hex 16
```

然后启动：

```bash
docker compose pull
docker compose up -d
```

浏览器打开 http://localhost 。页面标题应是 WeKnora。这是管理页，不要把这个地址发给普通访客。接口在 http://localhost:8080 ，请求头是 `X-API-Key`。

如果后面提问报 `embed session signing key is not configured`，回到这份 `.env` 检查 `SYSTEM_SIGNING_KEY`，再在 WeKnora 目录执行一次 `docker compose up -d`。

## 2. 配模型、知识库、API Key

WeKnora 管理员和网站登录账号不是同一个。在 http://localhost 自己注册一个管理员。

### 2.1 本机模型

安装 Ollama：https://ollama.com/download 。装好后保持一个终端不要关：

```bash
ollama serve
```

另开一个终端下载两个模型：

```bash
ollama pull qwen3:8b
ollama pull bge-m3
```

### 2.2 用已有的知识库

文件要进的库已经建好，ID 是 `28c5553a-5890-434c-8bba-0c279489264c`。在 WeKnora 管理页打开这个库，确认模型是下面这两项。如果这台机器还没有这个库，按同样的 ID 无法凭空创建，先找库的主人，不要自己新建一个空库来代替。

初始化时的模型配置是：

- 对话模型选 Ollama，名称 `qwen3:8b`，地址 `http://host.docker.internal:11434`
- 向量模型（Embedding）选 Ollama，名称 `bge-m3`，维度 `1024`，地址同样是上面这个

地址不要写成 `localhost`。WeKnora 跑在 Docker 里，那里的 `localhost` 指不到你电脑上的 Ollama。模型列表是空的，说明还没下载完，下完再点刷新。

导入命令不会读取默认库。每次都要显式带上 `--kb 28c5553a-5890-434c-8bba-0c279489264c`。

### 2.3 ReRank 和智能体

Ollama 不能做重排。在 WeKnora 里添加 ReRank 模型，来源选 API，服务商选硅基流动 SiliconFlow：

- 地址：`https://api.siliconflow.cn/v1`
- 模型：`BAAI/bge-reranker-v2-m3`（名字前面带 `Pro/` 的那个收费）
- 密钥：到 https://cloud.siliconflow.cn 注册后自己新建

点「测试连接」，成功后再保存。然后建一个智能体，检索范围选刚才的知识库，在智能体的模型配置里把 ReRank 选成这个模型。

如果提问报 `rerank model is not configured`，就是这一步没选上。

### 2.4 把三样东西填进网站

打开「设置 → 网页嵌入」，新建渠道并绑定这个智能体。允许嵌入的域名先填：

```text
http://127.0.0.1:5173
http://localhost:5173
```

在 `backend/.env` 里填（这个文件已被 git 忽略，密钥不要写进文档、不要发到群里）：

| 变量 | 去哪里抄 |
| --- | --- |
| `WEKNORA_BASE_URL` | `http://localhost:8080` |
| `WEKNORA_API_KEY` | 设置 → 发布集成 → API 集成，新建一把 |
| `WEKNORA_KB_ID` | `28c5553a-5890-434c-8bba-0c279489264c` |
| `WEKNORA_CHANNEL_ID` | 嵌入代码里 `data-channel="..."` 中间那一串 |
| `WEKNORA_PUBLISH_TOKEN` | 以 `em_` 开头的发布令牌 |

改完 `.env` 后，重启 `npm run dev:backend`。批量上传本身只用到前三项；渠道和发布令牌是网站提问挂件用的。

## 3. 资料长什么样

真数据包在：

```text
inputs/六尺巷基金会 零废弃知识库附件包 260929/
├── 零废弃知识库.xlsx
└── 零废弃知识库-FILE（分类文字版）/
    ├── 知识查询（零废弃）/上传知识/
    └── 知识查询（化学品）/上传知识/
```

Excel 有两张表，列不完全一样。

| | 知识查询（零废弃） | 知识查询（化学品） |
| --- | --- | --- |
| 约多少行 | 481 | 125 |
| 文件列 | `上传知识` | `上传知识` |
| 四个标签 | 知识发布机构、知识发布年份、知识类型、知识领域 | 前三项有，**没有知识领域** |

文件大多直接躺在各自的 `上传知识/` 下面，文件名和单元格一致，形如 `2-咖啡渣堆肥指南-咖啡渣堆肥指南.pdf`。少数一条记录对应一个子文件夹里的多份附件，单元格里用逗号把多个文件名串在一起。还有少数单元格里的换行，在磁盘文件名上被换成了下划线。

导入工具期望的输入和这个包不一样。它要的是一个目录里的三样东西：

- `metadata.xlsx`：表头里要有 `文件名`，以及要写入的那些列
- `mapping.json`：Excel 列名到 WeKnora 字段的对照
- `files/`：文件名和 `文件名` 列完全一致（符号链接即可）

所以不要把原始 xlsx 和整个分类文件夹直接丢给导入命令。先抽出一小批，生成它认得的目录，再上传。抽批脚本是 `inputs/batches/stage-next.mjs`。

## 4. 标签怎么落进去

书架筛选用的是 WeKnora 上每条知识的 `custom_metadata`，键名就是中文：

- `知识发布机构`
- `知识发布年份`，另外再写一份 `年份`（书架代码认的是 `年份`，只写前一个的话年份筛选是空的）
- `知识类型`
- `知识领域`
- `知识名`、`文件名`（方便对账）

空单元格写成 `未标注`。化学品表没有知识领域，抽批时这一列留空，导入后就是「未标注」。

这张基金会表里的知识领域是**一个标签**，包括 `食物/有机废弃物`。斜杠是标签的一部分。抽批时会把本批的 `mapping.json` 里「知识领域」的 `multiValue` 设成 `false`，避免被拆成「食物」和「有机废弃物」。仓库根上的 `inputs/mapping.json` 仍是给早期测试表用的（那里的领域可能是「垃圾分类、塑料」这种真多值），不要为了这批数据去改那个文件。

上传到库里的文件名用「知识名 + 原扩展名」，例如 `咖啡渣堆肥指南.pdf`。磁盘上那串 `2-标题-标题.pdf` 只作为找到原文件的线索。这样书架上的标题可读，也和已经入库的那批命名方式对齐。

WeKnora 有两个容易看混的字段：

1. 上传接口 multipart 里的 `metadata`，落在 `knowledge.metadata`
2. 书架真正读的 `custom_metadata`，要再发一次 `PUT /api/v1/knowledge/:id`

导入命令把这两步包在一起。报告里标了成功，只说明当时 PUT 返回成功。解析是异步的，`parse_status` 会从 `processing` / `finalizing` 走到 `completed`。曾经出现过解析收尾把 `custom_metadata` 盖成空对象的情况。所以传完要等解析结束再读一次标签，空了就按报告里的 JSON 补写。

单文件超过 **50MB** 会被拒绝，HTTP 400，原文是「文件大小不能超过50MB」。抽批脚本会把这些文件留在队列外。2026-10-09 实测有 6 份超限，最大约 231MB。

## 5. 每次传 10 个

在仓库根目录执行。Node 用 20 或更高。`--kb` 固定为 `28c5553a-5890-434c-8bba-0c279489264c`。

先看下一批会是哪 10 个。脚本只生成目录，不上传。它会跳过库里已经有的知识名，也会跳过超过 50MB、一行多文件、对不上磁盘的行。

```bash
node inputs/batches/stage-next.mjs --size 10 --batch 3
```

`--batch` 是目录编号。1 和 2 已经用过，下一班从 3 开始，不要覆盖已经传完的批次目录。终端会打印这 10 条的知识名、机构、年份、类型、领域和体积。对得上表再继续。

生成物在 `inputs/batches/batch-003/`：

- `metadata.xlsx`：导入工具要读的表
- `mapping.json`：本批列映射（知识领域不按斜杠拆）
- `files/`：指向原始 PDF 的符号链接
- `manifest.json`：每一行对应的 Excel 行号和源文件路径

确认之后上传：

```bash
npx tsx backend/src/modules/ingest/import.cli.ts \
  --kb 28c5553a-5890-434c-8bba-0c279489264c \
  --input inputs/batches/batch-003 \
  --report inputs/batches/batch-003/import-report.json
```

也可以：

```bash
npm run ingest --workspace backend -- \
  --kb 28c5553a-5890-434c-8bba-0c279489264c \
  --input ../inputs/batches/batch-003 \
  --report ../inputs/batches/batch-003/import-report.json
```

第二条的工作目录是 `backend/`，所以输入路径要带 `../`。

同一条命令可以先加 `--dry-run`，只打印将要写入的标签，不上传。

跑完看终端汇总，应接近 `合计 10 ｜ 成功 10 ｜ 跳过 0 ｜ 失败 0`。详细清单在同目录的 `import-report.md`。失败行带着原因。已经在库里的同名文件会标「已存在」，再跑一遍不会复制出第二条。

幂等看的是**上传文件名**（知识名.pdf），不是磁盘上那个带序号的原名。库里最早的一批用的是另一套清洗后的文件名，和 `1-标题-标题.pdf` 对不上，所以抽批脚本再按知识名跳过一次，避免同一篇被传进第二条。

## 6. 传完核对

用接口读回，确认四个标签还在，并且 `parse_status` 已经是 `completed`。下面这段只打印条数和标签，不会把 API Key 打出来。它读的是 `backend/.env` 里的 `WEKNORA_KB_ID`，这一项必须是 `28c5553a-5890-434c-8bba-0c279489264c`。

```bash
node --input-type=module << 'EOF'
import { readFileSync } from 'node:fs'
const env = readFileSync('backend/.env', 'utf8')
const get = (k) => env.match(new RegExp('^' + k + '=(.*)$', 'm'))[1].trim().replace(/^["']|["']$/g, '')
const res = await fetch(
  `${get('WEKNORA_BASE_URL')}/api/v1/knowledge-bases/${get('WEKNORA_KB_ID')}/knowledge?page=1&page_size=20`,
  { headers: { 'X-API-Key': get('WEKNORA_API_KEY') } },
)
const body = await res.json()
console.log('total', body.total)
for (const item of body.data ?? []) {
  const m = item.custom_metadata ?? {}
  console.log([
    item.parse_status,
    item.file_name,
    m['知识发布机构'],
    m['知识发布年份'],
    m['知识类型'],
    m['知识领域'],
  ].join(' | '))
}
EOF
```

要让公众站书架出现新条目，再同步一次本地索引。这条命令用的是 `.env` 里的 `WEKNORA_KB_ID`，所以同步前先确认它就是 `28c5553a-5890-434c-8bba-0c279489264c`：

```bash
npm run sync:index --workspace backend
```

书架上的年份、机构、类型、主题来自 `年份`、`知识发布机构`、`知识类型`、`知识领域`。同步之后抽一条，看这四项不是「未标注」（表里本来就空的除外）。

## 7. 2026-10-09 第一批实录

目标库 `28c5553a-5890-434c-8bba-0c279489264c` 里当时已有 10 条。按表从前往后抽了 10 份：8 份成功，2 份因超过 50MB 失败（《垃圾源头分类——全球城市案例集》215MB，《零废弃学校建设指南 2.0》153MB）。又补了表里接下来两份 50MB 以内的，所以这一轮实际新进 10 条，库内总数变为 20。

读回时「食物/有机废弃物」仍是一个领域。部分 PDF 当时还在 `finalizing`，标签已经写入。

这一轮留下的、脚本会自动避开的情况：

- 超过 50MB：6 份
- 一行对应 2 或 3 个附件：9 行（先不拆开传）
- 单元格里的文件名在磁盘上对不上：9 行
- `上传知识` 为空：3 行
- 其余单文件、能对上、不超过 50MB：当时还约 560 份

这些数字会随下一批变化。以第 6 节读回的 `total` 和抽批脚本打印的 `pendingSingleFile` 为准。

## 8. 碰到这些情况时

| 现象 | 原因 |
| --- | --- |
| 导入命令立刻退出，提示必须传 `--kb` | 故意不给默认库。补上 `--kb 28c5553a-5890-434c-8bba-0c279489264c` 再跑 |
| HTTP 400「文件大小不能超过50MB」 | WeKnora v0.8.2 的单文件上限。这份先留在磁盘上，不要拆开重试把半个文件传进去 |
| 报告成功，过几分钟标签变成空 | 解析收尾盖掉了 `custom_metadata`。等 `parse_status=completed` 再读；空了就按该行报告里的 JSON 再 PUT 一次 |
| 同一份资料出现两条 | 上传接口本身不去重。只通过本文的抽批脚本和导入命令重跑；不要在管理页再手工传同名文件 |
| 化学品资料的领域全是「未标注」 | 那张表没有这一列，不是传丢了 |
| 映射报错，信息里带一整行表头 | `mapping.json` 的 `column` 和 Excel 表头不一致。改配置，不要改导入代码 |
