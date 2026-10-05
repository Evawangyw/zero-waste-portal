# DATA-01 测试数据回填 · 交付说明与实测回显

> 派发：2026-10-05｜ 执行方：执行开发 ｜ 任务卡：`docs/task-cards/DATA01-测试数据回填.md`
> 目标库：「111」`ab5f8c28-1231-4a9e-93b0-a707af652d40`（已清零，本卡全程只碰这一个库）
> 验收命令：`npx tsx scripts/data01/verify-acceptance.mjs`（PASS 11 ｜ FAIL 0）

## 一、结论

18 份**中文**公开 OA（开放获取）PDF 已灌进「111」库，Excel 元数据逐字段与 `custom_metadata` 一致，
书架索引对账 `inSync=true`，红线自查零个人信息。5 条验收标准全过。

## 二、文件来源（红线④：全部公开可复核）

### 2.1 采集路径

搜索引擎（Bing）在本机被污染成只匹配首词、UNEP `wedocs` 返回 403、`mee.gov.cn` / `gov.cn`
政策附件走 JS 动态渲染抓不到 PDF 直链、Bing RSS 同款污染 —— **中文官方政策 PDF 这条路在本机走不通**。

改用 **OpenAlex 开放获取索引**（`api.openalex.org`，无密钥、公开），
`filter=language:zh,is_oa:true,has_fulltext:true` 精确捞中文零废弃主题 OA 全文，
配合标题强相关词过滤（`垃圾|固废|零废弃|危废|厨余|塑料|再生|回收|焚烧|填埋|循环经济|减量|资源化|堆肥`）：

| 阶段 | 数量 |
| --- | --- |
| 10 组中文检索原始命中（去重） | 311 |
| 标题强相关过滤后候选 | 136 |
| 下载并三重校验通过 | **18** |

18 份**全中文**（未用到 arxiv 英文兜底），主题覆盖固体废物、垃圾分类、焚烧发电、填埋处置、
危废处理、资源化利用、农业/园林废弃物、循环经济。

### 2.2 每份文件的三重校验（`scripts/data01/` 可复跑）

| 校验项 | 口径 | 结果 |
| --- | --- | --- |
| 文件头 | 前 5 字节必须等于 `%PDF-` | 18/18 PASS |
| 文件尾 | 尾部 1400 字节必须含 `%%EOF`（排除截断/伪装） | 18/18 PASS |
| 体积 | ≤ 15MB | 18/18 PASS，实际最大 1048KB（约 1.02MB） |
| 去重 | SHA-256 逐份比对 | 18 份互不相同 |
| 页数 | `/Type /Page` 计数 | 1~3 页 |

### 2.3 逐条公开性实探

18 条**当场**验证 DOI 解析 + HTTPS 直链返回 `application/pdf`：**18/18 通过**。
台账见 `inputs/data01-来源台账.json`（含 DOI、落地页、直链、字节数）。

来源期刊：生态环境与保护(4)、地质研究与环境保护(7)、工程管理与技术探讨(2)、
工程学研究与实用(2)、智能城市应用(1)、城市建筑与发展(1) —— 均为开放获取学术期刊。

### 2.4 个人信息排查

对全部元数据文本（文件名/知识名/知识发布机构/知识领域）正则扫描：

| 模式 | 命中 |
| --- | --- |
| 手机号 `1[3-9]\d{9}` | 0 |
| 身份证号 `\d{17}[\dXx]` | 0 |
| 邮箱 | 0 |
| 银行卡号 `\d{16,19}` | 0 |

**额外发现并清除了 42 条私人数据残留**（见第四节）——这是本卡立卡原因的实际风险点。

## 三、落地产物

```
inputs/
├─ files/                     18 份中文 OA PDF（8.4MB，单份 ≤1.02MB）
├─ metadata.xlsx              19 行（1 表头 + 18 数据），6 列
├─ mapping.json               列名映射（加了 1 行别名，见 5.3）
├─ import-report.json/.md     真导报告：成功 18 失败 0
├─ import-report.run2.json    幂等复跑报告：跳过 18 成功 0
├─ data01-dryrun-report.*     演练报告（未上传）
├─ data01-manifest.json       下载清单（含原始 URL/字节数）
└─ data01-来源台账.json       公开来源台账（红线自查依据）

scripts/data01/               本卡新增 6 个脚本（不改任何模块代码）
├─ build-metadata.mjs         manifest -> metadata.xlsx + 来源台账
├─ inspect-shelf.mjs          本地索引 vs WeKnora 差异诊断（只读）
├─ purge-stale-shelf.mjs      清除远端已删、本地残留的脏行
├─ fix-metadata.mjs           custom_metadata 完整性修复 + 3 轮复查
├─ wipe-kb.mjs                清空指定库（演练/真删）
└─ verify-acceptance.mjs      5 条验收标准逐条实测
```

`mapping.json` 列名与 Excel 表头完全对齐，故**只加了一行别名**（5.3），列名零改动。

## 四、途中发现并处理的 3 个真问题

### 4.1 本地索引残留 42 条私人文件（红线问题，已清）

`syncIndex` 只做 upsert **不做 delete**。小志把「111」库清零后，本地 `KnowledgeIndex`
仍残留 **42 行**已不存在的条目：

```
陕西宁陕 / 陕西丹凤 / 重庆城口 / 贵州榕江 / 贵州望谟 / 贵州天柱 / 甘肃陇西 /
甘肃通渭 / 甘肃甘谷 / 甘肃渭源 / 湖南龙山 / 湖南隆回 / 湖北英山 ……
```

**后果**：公开站书架会继续渲染这批私人文件标题 —— 既对不上账（`inSync=false`），
又直接踩「无任何真实个人信息」这条立卡红线。

已用 `purge-stale-shelf.mjs` 按「远端实存」口径清除（默认演练，`--purge` 才真删，
必须显式 `--kb`）。清完 `localRows=18 == remoteTotal=18`，`inSync=true`。

> 建议主控：`syncIndex` 应内置 purge 语义，否则**每次清库都会重现**，
> 且不止本库 —— 「批量导入测试」库同样会积累。这属 T01/T03 模块改动，未越界自行改。

### 4.2 WeKnora 异步解析与 custom_metadata 写入存在竞态（已绕开）

导入顺序是「上传 → 立刻 PUT `custom_metadata`」，但 WeKnora 上传后**异步解析**
（`parse_status` 走 `finalizing → completed`）。落在解析窗口内的那一条，
解析链收尾会把 `custom_metadata` 覆盖成解析结果（扫描版 PDF 即 `{}`）：

```
浅析固体废物污染防治与管理.pdf
  导入报告 outcome=success，PUT 回 200
  -> 但最终 custom_metadata = {}，parse_status=completed
  -> 书架该条 year/org/docType/topics 全「未标注」
```

18 条中 1 条中招。已用 `fix-metadata.mjs` 重新 PUT，并**连查 3 轮**（间隔 6s）
确认解析收尾后不再回滚；随后 syncIndex，全量 18 条书架 `year/org/docType/topics` 均完整。

> 这是导入工具的固有缺口：报告记 success 但元数据可能最终为空。
> 建议主控派单修 `ingest.run.ts`，在 PUT 后轮询 `parse_status` 终态再补写，
> 或在报告里标记「需复查」。本卡未改该模块。

### 4.3 书架年份维度本来会全空（配置层解决）

`docs.shelf.clean.ts` 硬编码 `META_KEY_YEAR = '年份'`，而任务卡规定的列名是「知识发布年份」。
两者对不上 → 书架 `year` 全「未标注」，年份筛选不可用。

利用 `mapping.json` 自带的「只改配置不改代码」扩展点，**同一列映射两个键**：

```json
{ "column": "知识发布年份", "key": "年份", "multiValue": false }
```

保留「知识发布年份」原键是为了验收标准②的逐字段一致性；加「年份」是让书架真正能用。
零代码改动。修复后书架年份分布：2025×5、2024×2、2023×3、2022×2、2021×1、2020×3、2019×1。

## 五、验收标准逐条实测

完整回显见 `scripts/data01/verify-acceptance.mjs` 输出（PASS 11 ｜ FAIL 0）。

### ① 「111」库 total == 导入报告成功数（10~20）

```
WeKnora  total = 18
导入报告 total=18 成功=18 跳过=0 失败=0
PASS  ① total 对账  18 == 18
PASS  ① 成功数落在 10~20  = 18
```

### ② 抽 3 份逐字段一致 + 书架可搜

抽样（首行/中间行/末行，覆盖不同年份与机构）：

```
── 抽样：浅析固体废物污染防治及管理.pdf
   knowledge id = 06a4444b-7323-4dfb-b3bf-667422267607   parse_status = completed
   ✅ 文件名       期望="浅析固体废物污染防治及管理.pdf" 实读="浅析固体废物污染防治及管理.pdf"
   ✅ 知识名       期望="浅析固体废物污染防治及管理"     实读="浅析固体废物污染防治及管理"
   ✅ 知识发布机构 期望="生态环境与保护"              实读="生态环境与保护"
   ✅ 知识发布年份 期望="2019"                    实读="2019"
   ✅ 知识类型     期望="测试资料"                  实读="测试资料"
   ✅ 知识领域     期望="固体废物、污染防治"          实读="固体废物、污染防治"
   书架 /api/docs?q=浅析固体废物污染防治及管理 -> HTTP 200 命中 1 条  ✅
```

单条完整 `custom_metadata` 原文：

```json
{
  "年份": "2019",
  "文件名": "浅析固体废物污染防治及管理.pdf",
  "知识名": "浅析固体废物污染防治及管理",
  "知识类型": "测试资料",
  "知识领域": "固体废物、污染防治",
  "知识发布年份": "2019",
  "知识发布机构": "生态环境与保护"
}
```

另两个抽样同样全绿（循环经济模式下生态环境保护的实践与反思 / 农村生活垃圾分类治理探讨），
故额外做了**全量 18 条**逐字段核对：`不一致 0 条`。

书架侧：

```
书架全量 /api/docs -> total = 18  items = 18
书架筛选 type=测试资料 -> total = 18
facets.types   = [{测试资料:18}]
facets.years   = [2025×5, 2024×2, 2023×3, 2022×2, 2021×1, 2020×3, 2019×1]
facets.orgs    = [地质研究与环境保护×7, 生态环境与保护×4, 工程管理与技术探讨×2, ...]
facets.tags    = [固体废物×7, 污染防治×6, 环境工程×5, 资源化利用×4, 垃圾分类×2, ...]
PASS  ② 书架 total == 导入成功数  18 == 18
```

### ③ 导入报告无失败

```
failed=0  skipped=0  results=18   全部 outcome = success
PASS  ③ 报告失败数 = 0
PASS  ③ 报告行数与 Excel 行数一致  18 == 18
```

幂等复跑（第二条命令）：`合计 18 ｜ 成功 0 ｜ 跳过 18 ｜ 失败 0`，库仍 18 条。

### ④ 红线自查

```
文件总数 = 18 ｜ 缺合法 DOI = 0 ｜ 非 https 直链 = 0
公开来源可复核 = 18/18（DOI 解析 + https 直链当场返回 PDF）
扫描 手机号/身份证号/邮箱/银行卡号 = 各 0 命中
脏行已清（本地索引 == 远端）= ✅
PASS  ④ 全部条目有合法 DOI + https PDF 直链
PASS  ④ 全部条目 DOI 与直链当场可复核  18/18
PASS  ④ 元数据零个人信息命中
```

### ⑤ lint / tsc 双零

| 命令 | 退出码 |
| --- | --- |
| `npm run lint` | 0 |
| `npm run typecheck`（frontend vue-tsc + backend tsc） | 0 |
| `npm run build --workspace backend` | 0 |
| `npm run test:ingest --workspace backend` | 通过 79 ｜ 失败 0 |
| `npm run test:shelf --workspace backend` | 通过 84 ｜ 失败 2（见 5.1） |
| `npm run format:check` | 剩 14 个存量告警，本卡新增文件全绿（见 5.2） |

#### 5.1 `test:shelf` 2 项失败的定性：**非本卡引入的回归**

```
失败清单：
  - 默认页真的只回 20 条 —— 18
  - 筛 未标注 = 该维度为空（不打死过滤）—— 0 vs 库内空值 0
```

两项都是**对库内数据量的前提假设**，与代码正确性无关：

| 断言 | 前提 | DATA01 前 | DATA01 后 |
| --- | --- | --- | --- |
| `默认页真的只回 20 条` | 库内 ≥ 21 行 | 60 行（含 42 条私人脏行）✅ | 18 行 → 只能回 18 条 ❌ |
| `筛 未标注 = 该维度为空` | 库内 ≥ 1 行 `docType` 为空 | 脏行多为空 ✅ | 18 条全部「测试资料」→ 空值 0 ❌ |

`git diff HEAD --stat -- backend/ frontend/` **无输出**，本卡对 backend/frontend 源码零改动，
该自测文件我一行没碰。其余 84 项（含查询逻辑、多选/跨维度、未标注哨兵、分页、
`tag=不存在的词 -> zeroResult`、QA-01 P0-1 回归）全部通过。

> 建议主控：这两项应改为「库内数据不足则 SKIP 并说明」，
> 与该文件第 183-196 行已有的年份倒序 SKIP 分支同款处理。当前写法把
> **测试数据规模**写成了硬断言，换任何一批数据都会红。

#### 5.2 `format:check` 14 个存量告警：已验证 HEAD 版本同样不合规

`format:check` 报 **14 个文件**不合规，逐个用 `git show HEAD:<file> | prettier --check`
验证，**HEAD 版本同样不合规**，即 T00 就在的存量，本卡不碰：

```
backend/package.json                       backend/tsconfig.build.json
backend/src/app.ts                         frontend/src/api/docs.ts
backend/src/modules/docs/docs.shelf.repo.ts    frontend/src/composables/useWidget.ts
backend/src/modules/docs/docs.shelf.router.ts   frontend/src/views/AdminStatsView.vue
backend/src/modules/docs/docs.shelf.selftest.ts frontend/src/views/DocDetailView.vue
backend/src/modules/track/index.ts         frontend/src/views/HomeView.vue
backend/src/modules/track/track.router.ts
backend/src/modules/track/track.selftest.ts
```

本卡新增的 6 个脚本 + 2 个 JSON 台账已 `prettier --write` 归零（`npx prettier --check scripts/data01/*.mjs` 通过）。

## 六、落盘自证

```bash
# 18 份 PDF
$ ls -la inputs/files/
农业废弃物资源化利用与环境污染综合治理五位一体生态循环.pdf   1017385
农村垃圾分类现状分析.pdf                                    248116
农村生活垃圾分类治理探讨.pdf                                  284457
危险废物处理现状研究.pdf                                      256009
园林废弃物的资源化利用.pdf                                    313565
固体废弃物资源化利用中的环境工程技术创新.pdf                    244830
垃圾填埋场稳定性分析.pdf                                      225744
工业固体废物现状及环境保护防治方法分析.pdf                        864349
循环经济模式下生态环境保护的实践与反思.pdf                        233294
浅析固体废物污染防治与管理.pdf                                864323
浅析固体废物污染防治及管理.pdf                                956872
浅析垃圾填埋场环境污染风险及防控.pdf                            226935
浅谈固体废物的污染防治与管理对策.pdf                            218021
浅谈环境工程中固体废物的治理.pdf                             1071505
浅谈生活垃圾焚烧发电厂环境保护管理.pdf                            239416
环境工程中垃圾处理利用的探究.pdf                               941491
环境工程建设中固体废物治理.pdf                                259491
生态环境工程咨询在城市固体废弃物处理与资源化利用中的探讨.pdf          248820
PDF 份数 = 18    总体积 = 8.4M    最大单份 1.02MB

# 元数据与报告
$ ls -la inputs/*.xlsx inputs/mapping.json inputs/import-report.json
-rw-r--r-- 22562  inputs/metadata.xlsx
-rw-r--r--  1274  inputs/mapping.json
-rw-r--r-- 11792  inputs/import-report.json
-rw-r--r-- 10899  inputs/data01-来源台账.json

# 本卡新增脚本
$ ls -la scripts/data01/
build-metadata.mjs  fix-metadata.mjs  inspect-shelf.mjs
purge-stale-shelf.mjs  verify-acceptance.mjs  wipe-kb.mjs
```

## 七、边界遵守

| 红线 | 落实 |
| --- | --- |
| 禁 git push | 未执行任何 push |
| 禁 Docker | 未执行任何 docker 命令（WeKnora 是本机已有容器，只发 HTTP） |
| 禁动 `backend/.env` | 未修改（全程只读，脚本内 `readFileSync` 加载） |
| 禁碰「批量导入测试」库 | 全部写操作经 `--kb ab5f8c28-...` 显式限定；该库 0 改动 |
| ai_ask 零次 | 未调用任何问答接口 |
| 公开来源、零个人信息 | 18/18 DOI+直链当场可复验；4 类 PII 正则 0 命中 |
| 不越界改他模块 | `git diff HEAD --stat -- backend/ frontend/` 无输出 |

## 八、需要主控拍板 / 建议派单

1. **`syncIndex` 缺 purge 语义**（4.1）—— 每次清库都会重现，且不止本库。
   建议单独立卡：同步时按远端口径清理该库已不存在的行。
2. **导入与异步解析的竞态**（4.2）—— 报告记 success 但元数据可能最终为空。
   建议修 `ingest.run.ts`：PUT 后轮询 `parse_status` 终态再补写，或报告标记需复查。
3. **`test:shelf` 把数据规模写成硬断言**（5.1）—— 建议改为数据不足时 SKIP。
4. **书架年份字段名不一致**（4.3）—— 本卡用 `mapping.json` 别名临时打通；
   根治要么 `docs.shelf.clean.ts` 改读「知识发布年份」，要么任务卡列名统一为「年份」。
   需确认基金会真实 Excel 用哪个列名。
5. **中文官方政策 PDF 抓不到**（2.1）—— 本机 mee.gov.cn / gov.cn 附件走 JS 动态渲染。
   若必须用政策原文，需引入无头浏览器渲染后再抓，本卡未做。