// 模块边界：docs —— 对外唯一出口
// T01 原始透传通道（GET /api/docs/weknora）
export { docsRouter } from './docs.router.js'
export type { DocsErrorResponse, DocsQuery, DocSummary } from './docs.types.js'
// T03 书架层
export { shelfRouter, parseShelfQuery } from './docs.shelf.router.js'
export { queryFacets, queryShelf } from './docs.shelf.repo.js'
export { syncShelfIndex, toShelfRow } from './docs.shelf.sync.js'
export {
  META_KEY_DOC_TYPE,
  META_KEY_DOMAIN,
  META_KEY_ORG,
  META_KEY_YEAR,
  cleanFileName,
  parseShelfMetadata,
} from './docs.shelf.clean.js'
export {
  MISSING_LABEL,
  SHELF_MAX_PAGE_SIZE,
  SHELF_PAGE_SIZE,
  SHELF_SORTS,
} from './docs.shelf.types.js'
export type {
  CleanResult,
  ParsedMetadata,
  ShelfAppliedFilters,
  ShelfErrorKind,
  ShelfErrorResponse,
  ShelfFacet,
  ShelfFacetsResponse,
  ShelfItem,
  ShelfListResponse,
  ShelfQuery,
  ShelfSort,
} from './docs.shelf.types.js'

// T04 文件层（详情 / 预览 / 下载）
export { fileRouter } from './docs.file.router.js'
export {
  FILE_META_KEY_DOMAIN,
  FILE_META_KEY_DOC_TYPE,
  FILE_META_KEY_ORG,
  FILE_META_KEY_YEAR,
  buildContentDisposition,
  buildDownloadFileName,
  isMetadataComplete,
  parseFileMetadata,
  resolveExtension,
  toMetadataView,
} from './docs.file.name.js'
export { findIndexedDoc } from './docs.file.repo.js'
export type { IndexedDocRow } from './docs.file.repo.js'
export {
  decidePreview,
  isPreviewableExtension,
  loadPreviewMaxBytes,
  resolveDocDetail,
  resolveDocForDownload,
  writeDownloadLog,
} from './docs.file.service.js'
export type { ResolvedDocForDownload } from './docs.file.service.js'
export {
  META_MISSING,
  PREVIEWABLE_EXTENSIONS,
  PREVIEW_CONTENT_TYPES,
  PREVIEW_MAX_BYTES,
} from './docs.file.types.js'
export type {
  DocDetail,
  DocDetailResponse,
  DocFileErrorKind,
  DocFileErrorResponse,
  DocParsedMetadata,
  DocParsedMetadataView,
  DownloadAvailability,
  PreviewAvailability,
  PreviewDecision,
  PreviewEnvelope,
} from './docs.file.types.js'
