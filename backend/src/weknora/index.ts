// 模块边界：weknora —— 对外唯一出口
// 铁律：全项目任何模块都只允许从本文件 import；禁止绕过它直连 WeKnora。
export { WeKnoraClient } from './client.js'
export { WeKnoraError, classifyStatus, messageForKind } from './errors.js'
export {
  DEFAULT_RETRIES,
  DEFAULT_SSE_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  loadDefaultKnowledgeBaseId,
  loadEnvFile,
  loadWeKnoraConfig,
  parseEnvFile,
  resolveEnvFilePath,
} from './config.js'
export { parseSseStream, isTerminalEvent } from './sse.js'
export { syncIndex } from './sync-index.js'
export type {
  KnowledgeIndexRow,
  KnowledgeIndexRowMapper,
  SyncIndexOptions,
  SyncIndexResult,
} from './sync-index.js'
export type {
  AskEvent,
  AskKnowledgeParams,
  BatchDownloadResult,
  ListKnowledgeParams,
  ListKnowledgeResult,
  WeKnoraBinary,
  WeKnoraConfig,
  WeKnoraErrorInit,
  WeKnoraErrorKind,
  WeKnoraKnowledge,
  WeKnoraSession,
} from './types.js'
