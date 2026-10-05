# T08lite 交付说明与实测回显（管理统计最简页）

> 卡：`docs/task-cards/T08lite-管理统计最简页.md`｜依赖：T02✅、T07✅｜执行轮：T08lite｜日期：2026-10-05
> 边界遵守：**后端 0 改动**（`git status --short backend` 为空）、未动 `backend/.env`、未用 Docker、
> 未 `git push`、未 commit（工作区变更留给主控）；未引任何图表库；未动 WeKnora。

---

## 0. 一句话交付

新增 `/admin/stats` 管理员统计页：**五块数据全部只读 `GET /api/admin/stats/summary` 的现成字段**，
零后端改动、零图表库；导航条对管理员显示「管理统计」入口、普通用户完全看不到该入口；
非管理员/未登录访问落到权限提示页（不报错、不白屏）。
验收 4 条全过，`build:frontend` / `lint` / `typecheck` / `format:check` 四零。

---

## 1. 契约先行：本卡对外暴露什么

只暴露三处，全部在 frontend 内，后端接口一个字节没动：

| 位置 | 对外暴露 | 说明 |
| --- | --- | --- |
| `frontend/src/api/admin.ts` | `fetchStatsSummary(token: string): Promise<StatsSummaryResponse>` | 本卡**唯一**取数出口；内部复用既有 `request<T>()`，路径 `/admin/stats/summary` 自动拼成 `/api/admin/stats/summary`，带 `Authorization: Bearer` |
| `frontend/src/router/index.ts` | 路由 `/admin/stats`（name `admin-stats`，meta `{ title: '管理统计', requiresAdmin: true }`） | 放在兜底 404 之前；**不加跳转守卫**（卡片要求"显示提示页"而非重定向） |
| `frontend/src/components/SiteNav.vue` | 导航项「管理统计」，`v-if="isAdmin"` | 判定依据是 `/me` 返回的 `user.isAdmin` |

内部常量：`TRACK_EVENT_LABELS`（7 类事件的中文标签 + 固定行序）、`ADMIN_STATS_REFRESH_MS = 5 * 60 * 1000`，加在 `frontend/src/constants.ts`（沿用该文件"key→label 映射归前端"的既有约定）。

### 五块数据 → 接口字段映射（无一处新增字段）

| 页面块 | 用的字段 |
| --- | --- |
| ① 总览 | `totals.pv` / `totals.uv` / `totals.registeredUsers` / `totals.events` |
| ② 事件分布（7 类） | `events` 对象的 7 个 key（行序由 `TRACK_EVENT_LABELS` 定，不依赖后端对象键序）；「占比」是页面上算的 `count / totals.events`，纯展示派生，不改口径 |
| ③ 检索热词 Top10 | `topSearchTerms[].term / .count` |
| ④ 零结果词列表 | `zeroResultSearchTerms[].term / .count` + 文案「内容缺口线索」 |
| ⑤ 下载 Top10 | `topDownloads[].fileName / .count`（可点进 `/doc/:id`）+ `downloads.logRows / .events` 对账 |
| ⑤ AI 提问 | `asks.total / .noAnswerRate / .judged / .unjudged`（`.noAnswer` 只用在口径脚注里） |

### 刷新方案（卡片要求二选一，此处说明选了哪个）

**两个都给了**：页面每 5 分钟自动刷新（`setInterval`，组件卸载时 `clearInterval`）**＋** 右上角「手动刷新」按钮。
理由：看板数字随埋点实时增长，自动刷新解决"开着不动就过期"，手动按钮解决"我现在就想看最新"。
若主控要求严格二选一，删掉 `onMounted` 里那 3 行 `setInterval` 与 `onUnmounted` 即可，页面其余部分不受影响。

---

## 2. 落盘自证

`git status --short`：

```
 M frontend/src/components/SiteNav.vue
 M frontend/src/constants.ts
 M frontend/src/router/index.ts
?? docs/shots/admin-stats-forbidden.png
?? docs/shots/admin-stats.png
?? frontend/src/api/admin.ts
?? frontend/src/views/AdminStatsView.vue
?? docs/交付记录/T08lite-交付说明与实测回显.md   ← 本文件
```

`ls -l frontend/src/views`：

```
-rw-r--r-- 1 a3230 197609 15749 Oct  5 12:28 AdminStatsView.vue   ← 本卡新增
-rw-r--r-- 1 a3230 197609 11968 Oct  5 04:31 AuthView.vue
-rw-r--r-- 1 a3230 197609 12211 Oct  5 04:31 DocDetailView.vue
-rw-r--r-- 1 a3230 197609  6519 Oct  5 03:43 HomeView.vue
-rw-r--r-- 1 a3230 197609   533 Oct  5 03:43 NotFoundView.vue
-rw-r--r-- 1 a3230 197609 17323 Oct  5 04:30 ShelfView.vue
```

`ls -l frontend/src/api`（本卡新增 `admin.ts`，1023 字节）：

```
admin.ts  auth.ts  docs.ts  embed.ts  http.ts  track.ts  types.ts
```

`git status --short backend | wc -l` → `0`（后端与 `.env` 一个字节没动）。

---

## 3. 验收标准逐条实测回显

> 环境：Node `v24.14.0`（全路径 `C:/Users/a3230/.workbuddy/binaries/node/versions/24.14.0/`）、npm `11.9.0`、无 pnpm。
> 前端 dev server `http://127.0.0.1:5173` 与后端 `http://localhost:4000` **复用已在跑的进程**，未重启、未改配置。
> 管理员测试账号 `13800000001`（`/me` 回 `isAdmin: true`），普通账号 `13900000010`（`isAdmin: false`）。

### 验收① 管理员能打开 `/admin/stats`，五块数据与 curl summary 一致 —— 通过

无头 Chrome 真实登录（`POST /api/auth/login` → JWT 写入 5173 origin 的 localStorage）→ 打开 `/admin/stats`。
为了排除"页面数字与接口数字之间隔了一会儿、埋点又涨了"的干扰，**同一次浏览器会话内**取两份回显：
① 页面渲染后的 DOM 文本；② 同一时刻、同一 JWT、同源 `fetch('/api/admin/stats/summary')` 的返回体。

登录回显：

```json
{ "ok": true, "status": 200, "isAdmin": true, "phone": "13800000001", "tokenLen": 203 }
```

页面渲染文本（节选，逐块）：

```
管理统计（最简版）
数据源：GET /api/admin/stats/summary · 生成于 2026/10/5 12:35:05 · 每 5 分钟自动刷新
手动刷新
① 总览            26 PV / 9 UV / 6 注册用户数 / 48 事件总数
② 事件分布（7 类）  页面浏览 page_view 26 (54.2%) · 检索 search 6 (12.5%) · 预览 preview 3 (6.3%)
                  下载 download 2 (4.2%) · AI 提问 ai_ask 9 (18.8%) · 注册 register 2 (4.2%) · 反馈提交 feedback_submit 0 (0.0%)
③ 检索热词 Top10   1 量子计算机废料处置 2 · 2 厨余 1 · 3 垃圾分类 1
④ 零结果词列表      1 量子计算机废料处置 2 [内容缺口线索]
⑤ 下载 Top10       1 2026-测试机构-第十九届成图大赛省赛-机械类-产品信息建模试题.pdf 5
                  2 云南南涧.xlsx 2
                  下载口径（后端双写）：DownloadLog 7 行（服务端权威）／ 前端埋点 2 条 — 两者不等：有接口被直连
⑤ AI 提问          提问总数 9 · 无答案率 50.0% · 已判定 4 · 未判定 5
                  口径：无答案率 = 无答案 2 ÷ 已判定 4；未判定 5 条不进分母。
```

同一时刻同源 summary 回显：

```json
{
  "status": 200,
  "body": {
    "generatedAt": "2026-10-05T04:35:07.581Z",
    "totals": { "events": 48, "pv": 26, "uv": 9, "registeredUsers": 6 },
    "events": { "page_view": 26, "search": 6, "preview": 3, "download": 2, "ai_ask": 9, "register": 2, "feedback_submit": 0 },
    "topSearchTerms": [ { "term": "量子计算机废料处置", "count": 2 }, { "term": "厨余", "count": 1 }, { "term": "垃圾分类", "count": 1 } ],
    "zeroResultSearchTerms": [ { "term": "量子计算机废料处置", "count": 2 } ],
    "topDownloads": [ { "fileName": "2026-测试机构-...产品信息建模试题.pdf", "count": 5 }, { "fileName": "云南南涧.xlsx", "count": 2 } ],
    "downloads": { "logRows": 7, "events": 2 },
    "asks": { "total": 9, "judged": 4, "noAnswer": 2, "unjudged": 5, "noAnswerRate": 0.5 }
  }
}
```

**逐条对齐结果：26/9/6/48、7 类事件计数、Top10 热词、零结果词、下载 Top10、DownloadLog 7 vs 埋点 2、提问 9 / 50.0% / 4 / 5 —— 页面与接口完全一致，零偏差。**

另附终端 `curl` 复核（管理员 JWT，12:38:29，此时我自己的验收浏览又新增了几个 page_view）：

```json
{"success":true,"generatedAt":"2026-10-05T04:38:29.580Z","totals":{"events":54,"pv":32,"uv":13,"registeredUsers":6},
 "events":{"page_view":32,"search":6,"preview":3,"download":2,"ai_ask":9,"register":2,"feedback_submit":0},
 "topSearchTerms":[{"term":"量子计算机废料处置","count":2},{"term":"厨余","count":1},{"term":"垃圾分类","count":1}],
 "zeroResultSearchTerms":[{"term":"量子计算机废料处置","count":2}],
 "topDownloads":[{"fileName":"2026-测试机构-...建模试题.pdf","count":5},{"fileName":"云南南涧.xlsx","count":2}],
 "downloads":{"logRows":7,"events":2},"asks":{"total":9,"judged":4,"noAnswer":2,"unjudged":5,"noAnswerRate":0.5}}
```

**关于 `pv / uv / events` 三项在三次采样间变化（26→27→32、9→10→13、48→49→54）**：这是我本人用无头浏览器验收时
每次打开 `/admin/stats` 都被 `router.afterEach` 正常记了一条 `page_view`——**埋点在正常工作**，不是页面口径算错。
其余全部指标（注册用户数、7 类事件里的非 PV 项、热词、零结果词、下载、提问）在三次采样中一字未变。

### 验收② 普通账号访问看到权限提示而非数据 —— 通过

账号 `13900000010`（`/me` 回 `isAdmin: false`）打开 `/admin/stats`，页面文本：

```
零废弃知识库
首页
资料书架                ← 导航条里没有「管理统计」入口（已隐藏）
路径员，你好
退出登录

需要管理员权限
当前账号不是管理员，看不到统计数据。如需开通，请让运维用 admin:promote 把该账号提为管理员。
当前账号：13900000010
回首页
```

同一时刻该账号直连接口 → 后端自己也拦（证明页面**不是**靠前端藏数据）：

```json
{ "status": 403, "body": { "success": false, "error": { "kind": "forbidden", "message": "需要管理员权限（该账号 isAdmin=false）" } } }
```

补测未登录（清掉 localStorage 直接访问）：显示「需要登录后访问」+「去登录」按钮，
同刻接口回 `401 INVALID_TOKEN`——三种权限态全部是提示页，**无白屏、无控制台报错**。

截图：`docs/shots/admin-stats-forbidden.png`（1440×760）。

### 验收③ `npm run build:frontend` 通过、lint 零报错 —— 通过

```
> zero-waste-portal@0.1.0 build:frontend
> vue-tsc --noEmit && vite build
vite v6.4.3 building for production...
✓ 1646 modules transformed.
dist/index.html                   0.41 kB │ gzip:  0.30 kB
dist/assets/index-1JJpiWjX.css  366.89 kB │ gzip: 49.22 kB
dist/assets/index-ba9LUPCp.js  1,097.11 kB │ gzip: 359.60 kB
✓ built in 30.14s
（>500kB chunk 提示是 element-plus 全量引入的既有现象，非本卡引入、非报错）
```

```
> npm run lint        → eslint .          退出码 0，零报错
> npm run typecheck   → vue-tsc --noEmit   零报错（strict: true，无 any）
> npm run format:check→ prettier --check . → All matched files use Prettier code style!
```

### 验收④ 回报附 ls + 截图 —— 通过

- `ls -l frontend/src/views`、`ls -l frontend/src/api`、`git status --short` 见 §2（已落盘）。
- 截图（Chrome `--headless=new --screenshot`，管理员视角，五块齐全）：

```
" C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
  --user-data-dir=<临时 profile> --no-first-run --disable-gpu --hide-scrollbars \
  --window-size=1440,1900 --virtual-time-budget=25000 \
  --screenshot=E:/projects/zero-waste-portal/docs/shots/admin-stats.png \
  http://127.0.0.1:5173/admin/stats
→ 167115 bytes written to file E:/projects/zero-waste-portal/docs/shots/admin-stats.png
```

  路径：**`docs/shots/admin-stats.png`**（页面生成时间 12:35:55；截图里导航条可见「管理统计」入口、右上「验收员，你好」）。
  管理员登录态的播种方式：先用 CDP（同源 `POST /api/auth/login` → 写 localStorage）灌进一个临时 Chrome profile，
  再用上面这条**纯 CLI** 命令出图；临时 profile 与辅助脚本都在系统临时目录，**不在仓库内**。

---

## 4. 边界与红线自查

| 红线 | 结论 |
| --- | --- |
| 零后端改动 | ✅ `git status --short backend` 输出为空；只调 T07 已有的 `GET /api/admin/stats/summary` |
| 零图表库 | ✅ 只用已在用的 Element Plus（`el-card/el-table/el-descriptions/el-result/el-tag`），`package.json` 未新增依赖 |
| 禁 `git push` / 禁 Docker / 禁动 `backend/.env` | ✅ 均未执行；未 commit |
| 密钥不进代码/文档/截图 | ✅ 页面与脚本都只拿 `authToken()`；截图与回显里只有手机号与 `tokenLen`，无 JWT 明文 |
| 质量关 | ✅ strict + 无 any + eslint/prettier/typecheck 全零 |
| 类型来源 | ✅ `StatsSummaryResponse` 沿用 T07 已在 `api/types.ts` 里的类型，本卡**没有**新造一份 summary 类型 |

**需要主控知情的一处越界（按字面算超出了卡片"frontend 内新增/修改 views 与 router 即可"）**：
改了 `components/SiteNav.vue`（加管理员导航入口）——卡片产出要求第 1 条明确写「导航条对管理员显示入口、对普通用户隐藏」，
不改导航条就实现不了该条，故按"卡片意图优先"处理。改动面为纯增量：一个 `isAdmin` computed + 一个 `v-if` 链接，
未触碰既有导航项、登出逻辑与样式类。另在 `constants.ts` 追加两个常量（同为纯增量）。若主控认为这两处需拆卡，回退成本极低。

**已知限制（如实说明）**：

1. `pv/uv` 等指标会随任何人打开该页而增长（本卡验收自己就贡献了 6 条 `page_view`）。这是 T07 埋点设计的必然，
   不是 bug；但意味着**同一时刻的两次 summary 快照不可直接相减当增量**（分不清是人访问还是看板自己被访问）。
2. 「⑤ 下载 Top10」里那个 `两者不等：有接口被直连` 标签是**真实信息**（DownloadLog 7 行 vs 前端埋点 2 条），
   来自 T07 契约 §6 的双写设计（curl 直连下载不经前端埋点）。本卡只如实显示，未做任何"修正"。
3. `noAnswerRate` 只对"站内可拿到回答证据的提问"负责（分母是 `judged` 不是 `total`），官方挂件面板里直接打字的问题记为「未判定」——
   这是 T07 契约 §5 已声明的边界，页面照抄并在脚注里写明，没在页面上二次解释口径。
4. 自动刷新定时器只在管理员登录态下启动；登出后组件卸载会 `clearInterval`，不留后台轮询。

---

## 5. 给节后 T08 正式版的备忘（本卡刻意没做）

- 图表库（ECharts 等）、时间范围筛选、维度下钻、CSV 导出、按天趋势——全部留给正式版。
- 正式版做权限时建议把 `meta.requiresAdmin` 从"声明式标记"变成真正的路由守卫，并把页面里的
  `el-result` 提示页保留为守卫的兜底（现在守卫与提示页是同一套判定逻辑，迁 RBAC 时只需换数据源 `currentUser.isAdmin`）。
- 若要展示"按天趋势"，现有 summary 接口给不了（它只给聚合值），需要 T07 侧加聚合端点——**属新后端能力，须先报主控**。