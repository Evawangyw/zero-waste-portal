# T01 WeKnora 对接层（任务卡）✅ 验收通过 2026-10-05

> 来源：规划 v1.1 §6 ｜ 依赖：T00 ✅ ｜ 派发：2026-10-05

## 目标

`backend/src/weknora/`：封装对内网 WeKnora 的全部调用，作为全项目唯一对接层（其他模块禁止直连 WeKnora）。

## 主控已实测的环境事实（直接采信，不要重新摸索）

- 服务 `http://localhost:8080`（.env 的 `WEKNORA_BASE_URL`），认证头 **`X-API-Key: <WEKNORA_API_KEY>`**（.env 已备好，读它，key 不许出现在任何源码/文档里）
- 测试知识库 ID 在 `.env` 的 `WEKNORA_KB_ID`
- 会话问答：`POST /api/v1/sessions`（body `{"title"}`）→ `POST /api/v1/knowledge-chat/<会话id>`（body `{"query":"...", "knowledge_base_ids":[...]}`）→ **SSE 流式**（行格式 `event:xxx` + `data:{json}`，`response_type` 为 thinking/正文，`done:true` 结束）
- 文件列表：`GET /api/v1/knowledge-bases/:id/knowledge`（分页 page/page_size，支持 keyword/tag_ids/sort_by）
- 元数据：每条 knowledge 带 `custom_metadata`（JSON，键如 年份/知识类型/知识领域/知识发布机构）
- 批量下载：`POST /api/v1/knowledge-bases/:id/knowledge/batch-download`
- 预览：`GET /api/v1/knowledge/:id/preview`；下载：`GET /api/v1/knowledge/:id/download`
- ⚠️ keyword 搜不到 custom_metadata 值；列表无按元数据筛选/排序参数（主控实测过）

## 产出要求

客户端类 `WeKnoraClient` 至少 6 个方法：`listKnowledge`(分页遍历)、`getKnowledge`、`preview`、`download`(流式透传)、`createSession`、`askKnowledgeBase`(返回 SSE 流或 async iterator)。统一错误处理（网络错/401/429/5xx 分类）+ 超时（默认 15s，SSE 除外）+ 重试（GET 幂等重试 2 次）。

**元数据索引表（Prisma 新增）**：`KnowledgeIndex` 表——knowledge_id、title、custom_metadata(JSON)、tags(JSON)、updated_at；供后续书架筛选排序用。本卡先建表+写一个 `syncIndex()` 方法（全量拉取 KB 列表 upsert 进表），不要求定时任务。

## 验收标准（主控将逐条实测）

1. `GET /api/docs`（自建后端路由）返回测试库中文件的标题 JSON 数组（含 custom_metadata 字段）
2. `POST /api/ask` body `{"query":"你好"}` 返回流式回答（curl 可见 SSE 或流式文本）
3. `syncIndex()` 跑一遍后 SQLite `KnowledgeIndex` 行数 = WeKnora 列表 total
4. `npm run lint` 零报错、`tsc --noEmit` 零报错（strict）
5. 回报附 ls + 每条验收命令回显

## 边界

- 不做书架路由的筛选/排序逻辑（那是 T03）；不做 JWT（T02）
- 测试用 query 只发 2 次以内（别烧人家模型额度）
