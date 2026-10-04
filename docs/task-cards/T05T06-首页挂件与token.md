# T05+T06 首页/挂件嵌入 + token 交换接口（合并任务卡）✅ 验收通过 2026-10-05

> 来源：规划 v1.1 §6 阶段三（两卡强耦合合并执行）｜ 依赖：T02✅、T03✅、T04✅ ｜ 派发：2026-10-05

## 目标

公众能打开网站首页、点示例问题、在挂件窗里免登录提问并看到流式答案；挂件的会话凭证由我们后端交换（publish token 不落前端）。

## 主控已实测的事实（直接采信）

- 渠道已建好：`WEKNORA_CHANNEL_ID` / `WEKNORA_PUBLISH_TOKEN` / `WEKNORA_ALLOWED_ORIGINS` 都在 backend/.env
- 交换接口：`POST {WEKNORA_BASE_URL}/api/v1/embed/{channel_id}/exchange`，头部 `Authorization: Embed <publish_token>`，**必须带 `Origin` 请求头**且值在 allowed_origins 里（body 里传 origin 无效！）；返回 `{data:{session_token, expires_in:1800}}`
- 会话凭证 30 分钟过期，前端要静默续期（快过期时再换一次）
- 官方挂件的嵌入方式：查 `website-docs/03-features/13-embed-channel.md`（在 WeKnora 仓库 E:/projects/WeKnora），里面有挂件 script 的引入写法与 openWithQuery 预填 API；照官方写法接，不自写问答 UI

## 产出要求

### 后端（T06）
- `POST /api/embed/token`：校验 Origin → 调 WeKnora exchange → 返回 session_token 给前端；publish token 只在后端
- Q1 开关：`.env` 加 `REQUIRE_LOGIN_FOR_ASK=false`（默认关，黄老师拍板后改 true + 用 T02 的 JWT 中间件）

### 前端（T05，Vue3+Element Plus）
- 首页 `/`：第一屏 = AI 提问入口（主）+ 搜索框（次，跳书架）+ 3 个示例问题（对应 PRD 两类场景：清单式"零废弃领域有哪些相关政策？"、场景式"社区厨余堆肥活动怎么设计？"）；挂件按官方方式嵌入
- 书架页 `/shelf`：接 `/api/docs`（筛选/排序/分页/搜索）+ facets 渲染筛选项；零结果页常驻"试试问 AI"并预填关键词（openWithQuery）
- 详情页 `/doc/:id`：元数据 + 预览/下载按钮（下载前查登录态，未登录跳登录页）
- 登录/注册页 `/auth`：五字段+隐私勾选，调 T02 接口
- 路由与基础导航条（结构完整即可，不追求美化——小志明确 UI 后说）

## 验收标准（主控逐条实测）

1. `curl http://localhost:5173/` 首页含示例问题与挂件挂载点；`/shelf` 渲染 42 条（分页/筛选可用）；`/doc/:id` 可开；`/auth` 可注册登录走通
2. `POST /api/embed/token`（带 Origin 头）返回 session_token；不带 Origin 被拒
3. 挂件窗内真实提问一轮（主控验收时自己发）：能收到带流式的回答
4. 前端 `npm run build` 通过；`npm run lint` 零报错；tsc 双零
5. 回报附 ls + 关键 curl 回显

## 边界

- 不做管理页/看板（T07 只做后端落库）；不做美化动画；`.env` 禁动已有行（可加新行）
