// 系统设置：问答模型和用户的预览、下载、管理权限。
import { request } from './http'

export interface AskSettingsView {
  readonly vectorModel: string
  readonly installedVectorModels: readonly string[]
  readonly lexicalK: number
  readonly vectorK: number
  readonly fusedK: number
  readonly bailianModel: string
  readonly bailianBaseUrl: string
  readonly bailianKeySet: boolean
}

export interface UserAccessRow {
  readonly id: string
  readonly name: string
  readonly phone: string
  readonly org: string
  readonly canPreview: boolean
  readonly canDownload: boolean
  readonly isAdmin: boolean
}

export interface AskSettingsResponse {
  readonly success: true
  readonly ask: AskSettingsView
  readonly vectorIndexModel: string | null
  readonly vectorIndexMatches: boolean
}

export interface AdminSettingsResponse extends AskSettingsResponse {
  readonly users: readonly UserAccessRow[]
}

export function fetchAdminSettings(token: string): Promise<AdminSettingsResponse> {
  return request<AdminSettingsResponse>('/admin/settings', { token })
}

export function saveAskSettings(
  token: string,
  body: {
    readonly vectorModel: string
    readonly lexicalK: number
    readonly vectorK: number
    readonly fusedK: number
    readonly bailianModel: string
    readonly bailianBaseUrl: string
    readonly bailianApiKey: string
  },
): Promise<AskSettingsResponse> {
  return request<AskSettingsResponse>('/admin/settings', { method: 'PATCH', token, body })
}

export function updateUserAccess(
  token: string,
  id: string,
  body: { readonly canPreview?: boolean; readonly canDownload?: boolean; readonly isAdmin?: boolean },
): Promise<{ readonly success: true; readonly user: UserAccessRow }> {
  return request(`/admin/settings/users/${encodeURIComponent(id)}`, { method: 'PATCH', token, body })
}
