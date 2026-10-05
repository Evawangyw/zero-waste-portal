# QA01-FIX 交付说明与实测回显

> 卡号：QA01FIX｜依据：`docs/测试报告/QA01-问题清单.md`｜范围：P0 全修 + P1 全修 + P2 顺手修
> 执行：2026-10-05｜环境：前端 5173（复用已有 dev server）、后端 4000、WeKnora 8080/80
> Node 24.14.0（`C:/Users/a3230/.workbuddy/binaries/node/versions/24.14.0/`），无 pnpm，用 npm；跑 TS 用 `npx tsx`
> **未 `git push`、未动 Docker、未动 `backend/.env`、未碰 WeKnora 业务数据**

---

## 0. 一句话结论

P0 两条必修 + P1 四条 + P2 五条全部修完并逐条实测通过；三套自测脚本 **T03 68/68、T04 75/75、T07 40/40**，
另有 T04b 11/11、T06 20/20 一并回归，**0 失败**；lint / tsc / 前后端 build 四门全绿。

**两处需要主控知情的额外发现（不是本卡引入，但必须报）：**

1. **`build:backend` 在本卡开工前就是坏的**（`git stash` 验过 pristine HEAD 同样失败）：自测脚本用了 `import.meta`，
   而 `package.json` 未声明 `type:module`，tsc 按 CJS 输出并拒绝 `import.meta`（TS1470）。因为验收⑤要求
   build 三零，本卡顺带修了（把开发期 selftest 排除出产物）。**这是清单外改动，请主控确认是否接受。**
2. **`format:check` 在开工前就有 14 条警告**（`core.autocrlf=true` 与 prettier `endOfLine:lf` 冲突，
   仓库既有文件普遍是 CRLF）。本卡**没有顺手改这 14 个文件**（会给 diff 灌水），只保证**自己没新增**
   （用 `git stash` 前后对拍验证，见 §4）。

---

## 1. P0-1 主题筛选 —— 根因与修法

### 根因跟 QA-01 的猜测**不一样**，必须更正

QA-01 怀疑"存储格式与 `LIKE` 假设不一致"。实测**存储格式是对的**：

```
sqlite> SELECT DISTINCT "topics" FROM knowledge_index;
["测试领域"]     <- 1 条
[]               <- 41 条
```

真凶是**转义层级写错了**。原代码把拼好的整个模式丢进 `escapeLike()`：

```ts
Prisma.sql`"topics" LIKE ${escapeLike(TAG_LIKE_TEMPLATE.replace('{value}', tag))} ESCAPE '\'`
//                        ^^^^^^^^^ 连模板自带的 % 通配符一起转义了
```

于是 `%` 变成 `\%`，配 `ESCAPE '\'` 之后整个模式退化成**字面量匹配** —— 找的是 `%测试领域%` 这串字面文本，
而库里存的是 `["测试领域"]`，永远 0 条。**"带双引号 JSON"这个假设本身没错，错在把通配符当用户输入转义了。**

修法：**只转义用户给的主题值**，模板首尾的 `%` 原样留给 LIKE；并改用 `JSON.stringify(tag)` 取值，
自带首尾双引号，主题里含引号/反斜杠时也能对上真实存储格式。

```ts
const TAG_LIKE_TEMPLATE = '%{value}%'
function tagLikePattern(tag: string): string {
  return TAG_LIKE_TEMPLATE.replace('{value}', escapeLike(JSON.stringify(tag)))
}
```

> 顺带发现：自测里"筛 `塑料` 不该命中 `塑料污染`"这条元素级匹配语义，此前**从未被验证过**（库里只有一个主题值）。

### `topic` / `tags` 拼错参数名

按卡要求"要么生效要么 400，不许静默忽略"，选了**生效**：`?tag= ?topic= ?topics= ?tags=` 四个拼写等价（并集去重）。
真正认不出的参数名（如 `foo=`）仍按原口径忽略，不给前端 400 打断页面。

### 实测回显

```
== tag=测试领域 ==          total=1 | applied.tag=["测试领域"]
== 四维组合 ==              total=1 | 命中=第十九届成图大赛省赛-机械类-产品信息建模试题
== ?topic=（错拼）==         total=1 applied=["测试领域"]
== ?tags=（错拼）==          total=1 applied=["测试领域"]
```

自测新增 8 项（含逐个真实主题值命中 + 子串不误命中 + 三个别名），T03 由 60 → **68 项，0 失败**。

---

## 2. P0-2 连点吞问题 —— 修法与实证

### 复现与定位（读了官方 loader 源码 `weknora-widget.js`）

`openWithQuery` 的真身只是往 iframe 丢一条 `postMessage('open_with_query')`，**它自己不排队**。
而挂件 iframe 是**跨源**的（前端 `localhost:5173` vs 挂件 `localhost:80`，我们改不了），
上一条还在生成时收到新消息不会追加气泡 —— 问题被上游丢弃，而点击时我们这边**毫不知情还照记了 ai_ask**。

### 两条修法（都在 `frontend/src/composables/useWidget.ts` 内闭环）

1. **串行**：同一时刻只允许一条 in-flight，其余进队列；收到 iframe 的 `message_received` 才放下一条，并兜 90s 超时防死锁。
   → 用户点了必有且只有一个气泡。
2. **埋点对齐**：`ai_ask` 从"点击即上报"改到 iframe 回 confirm 的 **`message_sent`** 时才上报。
   → 上游真吞掉的不计数；顺带把"直接在挂件面板里打字"的提问也纳入了统计（原来完全没被记）。

### 实测回显（无头 Chrome，跨源 context 里数气泡）

```
挂件面板标题（P1-1）: 零废弃知识库助手
挂件内用户气泡 .embed-user-msg (3 条):
   - 零废弃领域有哪些相关政策？图片无法显示预览
   - 社区厨余堆肥活动怎么设计？图片无法显示预览     <- QA-01 里被吞的第 2 个
   - 生活垃圾分类工作有哪些考核要求？图片无法显示预览
挂件内 AI 回答块数量: 3

① 三个提问气泡都在？ ✅ 是（3/3，不再被吞）
② 页面发出 ai_ask 埋点 = 3 次（三个问题各一次，问题文本互不相同）
```

**ai_ask 计数对账**：库内 `15 → 21`，**正好 +6** = 本轮两轮各 3 次，**与真实发送数完全一致，未超 ≤6 红线**。

> 说明：跨源 iframe 用 CDP 的 `Runtime.executionContextCreated` 取挂件源自己的 contextId 再求值
> （QA-01 当初也是这样拿到 `.embed-user-msg` 数组的）。顶层 `document` 读不到它。

---

## 3. P1 / P2 逐条

| # | 问题 | 修法 | 实测回显 |
|---|---|---|---|
| P1-1 | 挂件标题露出「公众网站挂件-测试」 | 走 WeKnora 官方渠道接口 `PUT /api/v1/embed-channels/{id}` 改渠道名为「零废弃知识库助手」（卡片授权"渠道接口可改"） | 挂件面板标题回显 `零废弃知识库助手` |
| P1-2 | 承诺"答案带出处" | 改首页文案为「答案基于库内资料生成」，不删承诺也不虚承诺 | 首页还有"答案带出处"？`✅ 已无`；新文案在？`✅ 是` |
| P1-3 | 非法 JSON 返 HTML + 泄露内部报错 | 新建 `backend/src/middleware/json-error.handler.ts` 提到 `app.ts` 全局，覆盖所有 `/api/*`；只兜 body 解析类错误，业务错误原样 `next(err)` | 四接口全部 `HTTP 400 {"success":false,"error":{"code":"VALIDATION_FAILED","message":"请求体不是合法 JSON","issues":[]}}`；泄露检查 `0` |
| P1-4 | token 挂掉仍说"已就绪" | `mountWidget` 注入成功后**主动探一次 `/api/embed/token`**，探不到即置 error | 伪造成 502 后：`✅ 出现"AI 暂时不可用，请稍后再试"`；`✅ 不再谎报就绪` |
| P1-3b | 预览重复计数 | `DocDetailView` 按 `docId` 去重：自动预载与点按钮只记一次 `preview` | 代码级去重，见下 |
| P2-1 | 统计页两个「⑤」 | AI 提问块改「⑥」 | 区块编号实测 `①…⑤ 下载 Top10、⑥ AI 提问`；重号？`✅ 不重号` |
| P2-2 | `el-result icon="loading"` 非法值 | 改 `icon="info"` | `✅ 0 条` Vue warn |
| P2-3 | 预览标题显示 blob UUID | iframe `title` 用文件名 + 预览框上方加可见文件名 | `iframe title = 预览：第十九届成图大赛…试题.pdf`；`当前预览：…pdf` |
| P2-4 | 解析状态显示英文 `completed` | `formatParseStatus()` 中文化（认不出的原样透出，不瞎猜） | `解析状态	已完成` |
| P2-5 | 首页「共 42 条」硬编码 | 新增 `fetchShelfTotal()` 读接口 | 显示 `42` / 接口 `42` → `✅ 一致` |
| P2-8/P2-9 | 统计页口径说明 + 页面替管理员下结论 | 页面顶部加「统计口径说明」；下载差额只陈述数值（`差额 N 条（原因待查）`），删掉"有接口被直连" | 口径说明在？`✅ 是`；仍断言直连？`✅ 已改` |

### P1-3b 预览去重的口径说明

`loadDetail()` 进详情页会自动 `loadPreview()`（记 1 次），用户再点「在线预览」又记 1 次 —— 同一次预览记两遍。
现按 `docId` 去重：**换一份资料才允许重新计数**，同一条资料内的自动预载与手动点击只记一次。

---

## 4. 验收⑤：自测脚本 + 四门质量关

### 自测（基线 → 现在，全部 0 失败）

| 脚本 | 基线 | 现在 | 结果 |
|---|---|---|---|
| `test:shelf`（T03 书架） | 60 | **68** | `通过 68 项，失败 0 项 · 全部通过` |
| `test:file`（T04 详情/预览/下载） | 75 | **75** | `汇总：75 PASS / 0 FAIL` |
| `test:file:toolarge`（T04b） | 11 | **11** | `汇总：11 PASS / 0 FAIL` |
| `test:track`（T07 统计） | 34 | **40** | `结果：PASS 40 / FAIL 0` |
| `test:embed`（T06 挂件凭证，未改但回归） | 20 | **20** | `[embed] 自测结果：PASS 20 / FAIL 0` |

T03 的 60→68 与 T07 的 34→40 都是**新增回归用例**（P0-1 主题有值命中 + 别名；P1-3 任意 API 的坏 JSON 信封），
旧用例一条没删、没改断言。

### 四门质量关

```
--- lint ---            ✅ eslint 0 error
--- typecheck ---       ✅ vue-tsc + tsc 0 error
--- build:frontend ---  ✅ 成功
--- build:backend ---   ✅ 成功（本卡顺带修好，见 §0）
```

### prettier 未新增警告（前后对拍）

```
基线（git stash 到 pristine HEAD）：14 条
本卡之后：                          14 条
diff：空（无新增、无删除）
```

---

## 5. 事故与需要主控拍板的事

### ⚠️ 事故（已修复，如实报告）

探测渠道接口是否存在改接口时，我对 `PUT /api/v1/embed-channels/{id}` 发了一个 `{"name":"probe"}` 的**盲探请求**。
该接口是 **PUT 全量覆盖**语义，我的探针把 `allowed_origins` 覆盖成了 `null` —— 一旦发生，
所有挂件 token 交换都会 403。

**已立刻用完整字段写回并验证恢复**：

```json
{ "name": "零废弃知识库助手",
  "allowed_origins": ["http://localhost:3000","http://localhost:5173"],
  "allow_file_upload": false, "allow_web_search": false, "enabled": true,
  "header_title_mode": "channel", "rate_limit_per_day": 10000,
  "rate_limit_per_minute": 30, "show_suggested_questions": true,
  "widget_position": "bottom-right", "page_title": "", "primary_color": "" }
```

除 `name`（P1-1 本来就要改的）外，其余字段与事故前逐字段一致。后续所有验证跑通也证明功能完好。

**教训**：生产接口不可盲探。应该先 GET 拿现状、再做带完整字段的写。这个错误是我的。

### 需主控确认

1. `build:backend` 的修法（排除 dev-only selftest 出产物）是否接受 —— 清单外改动。
2. `format:check` 14 条 CRLF 警告本卡**没动**（避免灌 diff），是否要另派一张格式化单。
3. **P1-5 未处理**（按卡要求）：知识库里仍混着含真实学生信息的表格，上生产前必须单独派数据清洗单。

---

## 6. 落盘自证

```
$ git status --short
 M backend/src/app.ts                                        # 全局 JSON 错误信封
 M backend/src/modules/docs/docs.shelf.repo.ts                # P0-1 主题 LIKE 转义层级
 M backend/src/modules/docs/docs.shelf.router.ts              # P0-1 tag 别名
 M backend/src/modules/docs/docs.shelf.selftest.ts           # +8 回归用例
 M backend/src/modules/track/index.ts                         # 移除 trackJsonErrorHandler 导出
 M backend/src/modules/track/track.router.ts                  # 删除被全局 handler 覆盖的旧实现
 M backend/src/modules/track/track.selftest.ts                # +6 回归用例
 M backend/tsconfig.build.json                                # build 三零（清单外，见 §0）
 M frontend/src/api/docs.ts                                   # P2-5 fetchShelfTotal
 M frontend/src/composables/useWidget.ts                      # P0-2 串行队列 + 埋点对齐 + P1-4 探针
 M frontend/src/views/AdminStatsView.vue                      # P2-1 / P2-2 / P2-8 / P2-9
 M frontend/src/views/DocDetailView.vue                       # P1-3b 去重 + P2-3 + P2-4
 M frontend/src/views/HomeView.vue                            # P1-2 + P1-4 + P2-5
?? backend/src/middleware/                                    # 新增：JSON 错误信封
?? docs/shots/QA01FIX/                                        # 新增：验收截图

$ ls -la backend/src/middleware/
-rw-r--r-- 1 a3230 197609 3354 Oct  5 14:33 json-error.handler.ts

$ ls -la docs/shots/QA01FIX/
-rw-r--r-- 1 a3230 197609 139985 admin-stats.png       # P2-1/P2-2/P2-8/P2-9
-rw-r--r-- 1 a3230 197609 184103 ask-queue-after.png   # P0-2 三个气泡都在
-rw-r--r-- 1 a3230 197609 232510 detail.png            # P2-3 / P2-4
-rw-r--r-- 1 a3230 197609 134465 home.png              # P1-2 / P2-5
-rw-r--r-- 1 a3230 197609 141339 token-degraded.png     # P1-4 降级提示
```

---

## 7. 合规自查

- ✅ 未 `git push`（只改本地工作区，未提交、未推送）
- ✅ 未动 Docker
- ✅ 未动 `backend/.env`
- ✅ 未碰 WeKnora **业务数据**（knowledge / 文件）；只改了**挂件渠道显示名**（卡片 P1-1 明确授权"渠道接口可改"）
- ✅ ai_ask 全程 6 次（15 → 21），正好卡在红线，**未超**
- ✅ TypeScript strict 通过，ESLint 0 error，无 `any` 逃逸
- ✅ 密钥零落盘：新增代码无任何 key/token 字面量，渠道 publish_token 未写入仓库（比对用 sha256，不回显明文）