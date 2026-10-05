# T09-lite 批量导入工具 · 交付说明与实测回显

> 派发：2026-10-05 ｜ 执行方：执行开发 ｜ 任务卡：`docs/task-cards/T09lite-批量导入工具.md`
> 验收命令：`npm run test:ingest --workspace backend`（离线自测 79 项）
> 真库命令：`npm run ingest --workspace backend -- --kb <知识库ID> --input ../inputs`

## 一、可达成的目标

`inputs/` 一批文件 + `inputs/metadata.xlsx` 元数据表 + `inputs/mapping.json` 列名映射，
一条命令导入指定 WeKnora 知识库，逐份带custom_metadata，输出成功/跳过/失败三张清单的报告。
明天真Excel 到位后只改 `mapping.json` 的 `column` 值，不动代码。

## 二、契约（模块边界）

模块 `backend/src/modules/ingest/`，唯一出口 `index.ts`：

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 模块唯一出口 |
| `ingest.types.ts` | 全部数据结构（`IngestMapping` / `IngestRow` / `IngestReport` / `IngestUploader`） |
| `ingest.mapping.ts` | 读+校验 `mapping.json`，**唯一映射处** |
| `ingest.excel.ts` | 读 xlsx、按映射生成 `custom_metadata`、多值拆数组、空值落「未标注」 |
| `ingest.run.ts` | `runIngest()` 主流程：幂等 → 上传 → 写元数据 → 重试 2 次 → 出报告 |
| `ingest.report.ts` | 报告渲染与落盘（JSON + Markdown 同源） |
| `ingest.uploader.ts` | 真实 WeKnora 上传实现（`IngestUploader` 的生产适配） |
| `ingest.selftest.ts` | 离线自测79 项（假上传器，零网络） |
| `ingest.sample-xlsx.ts` / `ingest.sample-pdf.ts` | 重建样例输入（一次性工具） |
| `import.cli.ts` | 命令行入口 |

对 weknora 对接层只做了三处**加法**（不改既有行为，见第五节）。

## 三、关键设计决策与实测依据

### 3.1 列名映射全在 `inputs/mapping.json`

```json
{
  "headerRow": 1,
  "sheet": null,
  "fileColumn": "文件名",
  "emptyValue": "未标注",
  "multiValueJoiner": "、",
  "fields": [
    { "column": "文件名",       "key": "文件名",       "multiValue": false },
    { "column": "知识名",       "key": "知识名",       "multiValue": false },
    { "column": "知识发布机构", "key": "知识发布机构", "multiValue": false },
    { "column": "知识发布年份", "key": "知识发布年份", "multiValue": false },
    { "column": "知识类型",     "key": "知识类型",     "multiValue": false },
    { "column": "知识领域",     "key": "知识领域",     "multiValue": true  }
  ]
}
```

真Excel 列名有出入 → 只改 `column`。代码里没有任何中文列名常量。
列名对不上时抛 `MappingConfigError`，报错信息里带**实际表头**，主控一眼能看出该改哪个。

### 3.2 多值拆数组 vs WeKnora 只吃标量（实测冲突，已解决）

任务卡要求「知识领域多值 → 拆成数组」。但本机实测：

```
POST /api/v1/knowledge-bases/:kb/knowledge/file  (multipart metadata='{"知识领域":["垃圾分类","塑料"]}')
→ 200 {"error":{"code":1000,"message":"Invalid metadata format",
     "details":"json: cannot unmarshal array into Go value of type string"}}

PUT /api/v1/knowledge/:id  {"custom_metadata":{"知识领域":["垃圾分类","塑料"]}}
→ 500 {"error":{"code":1007,"message":"custom_metadata field \"知识领域\" must be a
     string, number, boolean, or null"}}
```

**结论：WeKnora v0.8.2 的 `custom_metadata` 值只接受标量。**
落地口径：数组是**解析层**的事实（`IngestRow.multiValues` 留档、自测断言它），
写进 WeKnora 的是 `multiValueJoiner`（默认「、」）join 后的字符串。
效果与书架侧 `docs.file.name.ts` 的 `TOPIC_SPLIT_RE` 反向操作完全对称。

### 3.3 「文件+元数据一次写入」在本机的真实形态

实测：multipart 字段名只认 `metadata`，它落到 `knowledge.**metadata**`；
而书架/详情读的是 `knowledge.**custom_metadata**` —— 两者不是一回事。
把 `custom_metadata` 当 multipart 字段名传，读回一律 `{}`。

所以实际是两段，但**对调用方是一次命令**：

1. `POST /api/v1/knowledge-bases/:kb/knowledge/file`（multipart：file + metadata）
2. `PUT /api/v1/knowledge/:id`（写 `custom_metadata`，这是书架认的那个字段）

第2 步失败会被归入同一行的失败/重试逻辑，不会出现「文件进去了但元数据没进去且无人知道」。

### 3.4 幂等：先查后写，不靠上传接口去重

上传接口非幂等（重试/重跑都会造重复条目），所以：

- 导入前 `listAllKnowledge` 拿库里已有文件名集合（小写归一），命中即跳过，报告标「已存在」
- 单条失败重试**前重新查一次**：首次上传可能其实成功了只是回包丢了，
  此时判成功并标「幂等命中」，不造重复（自测 6c 覆盖）

### 3.5 CLI 强制 `--kb`，不给默认值

导入是不可逆写操作。漏传就可能把 400 份资料灌进业务库，所以宁可报错退出。

## 四、验收标准逐条实测

### ① 导入后该库 3 条知识，custom_metadata 逐字段与 Excel 一致

```bash
npm run ingest --workspace backend -- --kb e81b4870-1ba7-48c4-884c-d40a79aee270 --input ../inputs
```

回显：

```
[ingest] 目标库=e81b4870-1ba7-48c4-884c-d40a79aee270 输入=../inputs
[ingest] 实际表头：文件名 | 知识名 | 知识发布机构 | 知识发布年份 | 知识类型 | 知识领域
[ingest] 合计 3 ｜ 成功 3 ｜ 跳过 0 ｜ 失败 0 ｜ 解析失败 0
  [OK  ] 第 2 行 样例文档一.pdf
  [OK  ] 第 3 行 样例文档二.pdf
  [OK  ] 第 4 行 样例文档三.pdf
```

API 读回逐字段核对（`GET /api/v1/knowledge/:id`）：

```
total = 3
  样例文档三.pdf ✅ 逐字段一致 | id=418a125d-ed80-42f8-b987-67dd55cfab23
  样例文档二.pdf ✅ 逐字段一致 | id=d57c889a-9c3d-4101-8a6f-b129c195fec7
  样例文档一.pdf ✅ 逐字段一致 | id=c2859e3d-d4dd-4c59-b6ce-0b93c7fbe753
逐字段核对结果： 全部一致 ✅
```

单条完整 JSON（`样例文档三.pdf`，留空行）：

```json
{
  "文件名": "样例文档三.pdf",
  "知识名": "厨余垃圾处理流程（样例三）",
  "知识类型": "未标注",
  "知识领域": "未标注",
  "知识发布年份": "未标注",
  "知识发布机构": "未标注"
}
```

单条完整 JSON（`样例文档一.pdf`，多值行）：

```json
{
  "文件名": "样例文档一.pdf",
  "知识名": "生活垃圾分类投放指引（样例一）",
  "知识类型": "投放指引",
  "知识领域": "垃圾分类、塑料",
  "知识发布年份": "2023",
  "知识发布机构": "示例公益基金会"
}
```

### ② 重复跑第二遍 → 报告显示 3 条「已存在」，库里仍是 3 条

```
[ingest] 合计 3 ｜ 成功 0 ｜ 跳过 3 ｜ 失败 0 ｜ 解析失败 0
  [SKIP] 第 2 行 样例文档一.pdf — 已存在
  [SKIP] 第 3 行 样例文档二.pdf — 已存在
  [SKIP] 第 4 行 样例文档三.pdf — 已存在
第2 遍跑完，库里 total = 3 （仍应为 3）
```

### ③ 空值字段落「未标注」

`样例文档三.pdf` 的机构/年份/类型/领域在 Excel 里为空，读回：

```
落「未标注」的字段   = ["知识类型","知识领域","知识发布年份","知识发布机构"]
非「未标注」的字段   = ["文件名","知识名"]
```

### ④ lint / tsc 双零

```
$ npm run lint          -> 退出码 0
$ npm run typecheck     -> 退出码 0（frontend vue-tsc + backend tsc）
$ npm run build --workspace backend -> 退出码 0
$ npm run test:ingest --workspace backend -> 通过 79 ｜ 失败 0
```

`npm run format:check` 剩 13 个文件告警，全部是 T00 就在的存量（已用
`git show HEAD:<file> | prettier --check` 逐个验证 HEAD 版本同样不合规），本卡不碰。

### ⑤ 回报附 ls + 导入报告内容 + API 读回的元数据 JSON

见本文件第三节与主控回报正文。报告文件：
`inputs/import-report.json` / `inputs/import-report.md`（第2遍）、
`inputs/import-report.run1.json` / `inputs/import-report.run1.md`（第1遍）。

## 五、对既有模块的改动（只做加法，边界内）

铁律要求触碰他模块先报主控，故在此列明。三处全在 `weknora` 对接层，均为新增，不改既有行为：

| 文件 | 改动 | 为什么必须动这里 |
| --- | --- | --- |
| `transport.ts` | `RequestSpec` 新增 `form?: FormData`、方法联合类型加 `PUT`/`DELETE`、新增 `requestFormJson()` | 上传是 multipart，JSON 通道发不了。form 与 body 互斥已断言 |
| `client.ts` | 新增 `uploadFile()` / `updateKnowledgeMetadata()` / `listExistingFileNames()` | 上传与写元数据是 WeKnora 协议细节，必须留在对接层，ingest 只依赖 `IngestUploader` 接口 |
| `types.ts` | 新增 `UploadFileParams` / `UploadFileResult` | 同上 |
| `index.ts` | 导出 `requestFormJson` 与两个新类型 | 对外出口保持唯一 |
| `package.json` | 加 `xlsx` 依赖 + 4 个 npm script | 任务卡允许装依赖 |

未改动：`docs` / `ask` / `auth` / `track` / `embed` / `health` 任何文件，`backend/.env` 未动。

## 六、已知限制与需要主控拍板的事

1. **`parse_status=failed`**：本机 WeKnora 解析链本身不通，纯 `.txt` 上传也是 `failed`，
   与本卡无关（写入与元数据均已落库）。但明天真数据导入后，**知识能不能被问答检索到**
   取决于解析链是否修好，这条不在本卡范围，建议派单给能改WeKnora 配置的人。
2. **多值只能 join 不能存数组**（3.2）。若主控坚持要真数组入库，需上游支持或换存储位。
3. **「111」库当前 total=0**：属DATA01 卡范围（清空私人文件换公开资料），本卡全程未碰。
   本卡所有写入与删除只针对「批量导入测试」`e81b4870-...`。
4. **导入不做本地索引同步**：跑完导入后需另跑 `npm run sync:index --workspace backend`
   才能在书架页看到新条目。本卡未自动串联（`WEKNORA_KB_ID` 指向的是业务库，
   自动同步有误同步风险）。
5. **xlsx 装的是官方 CDN 版0.20.3**：npm 上的 0.18.5 有 high 级原型污染/ReDoS 且无修复版；
   换exceljs 也有传递漏洞。0.20.3 装完 `npm audit` 只剩 T00 就有的 3 个 prisma 传递依赖 high。

## 七、明天真数据怎么用

```bash
# 1. 主控把真 Excel 放 inputs/metadata.xlsx，真文件放 inputs/files/
# 2. 对一遍列名，有出入只改 mapping.json 的 column
# 3. 先演练（不上传），确认解析与映射对
npm run ingest --workspace backend -- --kb <目标库ID> --input ../inputs --dry-run
# 4. 真导
npm run ingest --workspace backend -- --kb <目标库ID> --input ../inputs
# 5. 看报告 inputs/import-report.md
# 6. 让书架看到新条目
npm run sync:index --workspace backend
```

自造样例输入（当前库里那 3 条就是它们，可随时重建）：

```bash
npm run ingest:sample-pdf  --workspace backend   # 3 个文本型 PDF（无任何真实个人信息）
npm run ingest:sample-xlsx --workspace backend   # 3 行迷你 Excel
```