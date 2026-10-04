// 挂件凭证通道（T06）。
//
// **红线**：本文件与整个前端都拿不到、也不需要 publish token（em_ 前缀）。
// 前端只读后端下发的公开挂件配置（渠道 UUID + 挂件基址 + token 接口地址），
// 官方 weknora-widget.js 自己在安全模式下去 tokenEndpoint 换 30 分钟短效 session token。
import { request } from './http'
import type { EmbedPublicConfigResponse, EmbedTokenResponse } from './types'

/** GET /api/embed/config —— 公开、非敏感；前端据此注入官方挂件 script */
export function fetchEmbedConfig(): Promise<EmbedPublicConfigResponse> {
  return request<EmbedPublicConfigResponse>('/embed/config')
}

/**
 * POST /api/embed/token —— 卡片正式契约。
 * 页面一般不直接调它（挂件 loader 走的是 GET 形态），这里保留给「先换 token 再手动校验」
 * 的排障路径与将来可能的自有问答 UI。请求会带 Origin（浏览器自动附加）。
 */
export function fetchEmbedToken(jwt?: string | null): Promise<EmbedTokenResponse> {
  return request<EmbedTokenResponse>('/embed/token', {
    method: 'POST',
    token: jwt ?? null,
  })
}
