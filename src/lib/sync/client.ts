import { parseServiceInfo } from '@webwings/sync-protocol'
import { normalizeServerUrl } from './url'

export interface ApiFailure {
  status: number
  code: string
  message: string
}

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
  }
}

const jsonRequest = async <T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> => {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
  if (token) headers.authorization = `Bearer ${token}`
  let response: Response
  try {
    response = await fetch(`${normalizeServerUrl(baseUrl)}${path}`, { ...init, headers })
  } catch {
    throw new ApiClientError(0, 'network_error', '无法连接到同步服务')
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // non-JSON response body
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiClientError(response.status, error?.code ?? 'http_error', error?.message ?? `请求失败 (${response.status})`)
  }
  return body as T
}

export class SyncClient {
  readonly serverUrl: string

  constructor(serverUrl: string) {
    this.serverUrl = normalizeServerUrl(serverUrl)
  }

  info(): Promise<ReturnType<typeof parseServiceInfo>> {
    return jsonRequest(this.serverUrl, '/v1/info')
  }

  bindStart(payload: { srkey: string; deviceName?: string; deviceInfo?: string }): Promise<{
    v: 1
    bindSessionId: string
    bindToken: string
    expiresAt: string
    keyId: string
    keyPrefix: string
    role: 'admin' | 'sync'
    capabilities: string[]
    cloud: { hasData: boolean; cloudSeq: number; syncEpoch: number }
  }> {
    return jsonRequest(this.serverUrl, '/v1/bind/start', { method: 'POST', body: JSON.stringify({ v: 1, ...payload }) })
  }

  cloudSnapshot(sessionId: string, bindToken: string): Promise<{
    v: 1
    bindSessionId: string
    cloudSeq: number
    syncEpoch: number
    digest: string
    nodes: import('@webwings/sync-protocol').SyncNode[]
  }> {
    return jsonRequest(this.serverUrl, `/v1/bind/${encodeURIComponent(sessionId)}/cloud-snapshot`, {}, bindToken)
  }

  backupProof(
    sessionId: string,
    bindToken: string,
    proof: { cloudDigest: string; localDigest: string; localRevision: number; downloadState: 'complete'; downloadedAt: string },
  ): Promise<{ v: 1; status: 'ok' }> {
    return jsonRequest(
      this.serverUrl,
      `/v1/bind/${encodeURIComponent(sessionId)}/backup-proof`,
      { method: 'POST', body: JSON.stringify({ v: 1, bindSessionId: sessionId, ...proof }) },
      bindToken,
    )
  }

  bindComplete(
    sessionId: string,
    bindToken: string,
    payload: import('@webwings/sync-protocol').BindCompleteRequest,
  ): Promise<import('@webwings/sync-protocol').BindCompleteResponse> {
    return jsonRequest(
      this.serverUrl,
      `/v1/bind/${encodeURIComponent(sessionId)}/complete`,
      { method: 'POST', body: JSON.stringify(payload) },
      bindToken,
    )
  }

  refresh(refreshToken: string): Promise<{
    deviceId: string
    accessToken: string
    refreshToken: string
    accessTokenExpiresAt: string
    refreshTokenExpiresAt: string
  }> {
    return jsonRequest(this.serverUrl, '/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) })
  }

  push(
    accessToken: string,
    ops: import('@webwings/sync-protocol').SyncOperation[],
  ): Promise<import('@webwings/sync-protocol').PushResponse> {
    return jsonRequest(this.serverUrl, '/v1/sync/push', { method: 'POST', body: JSON.stringify({ v: 1, ops }) }, accessToken)
  }

  pull(
    accessToken: string,
    args: { after: number; limit?: number; epoch?: number },
  ): Promise<import('@webwings/sync-protocol').PullResponse> {
    const params = new URLSearchParams({ after: String(args.after), limit: String(args.limit ?? 200) })
    if (args.epoch !== undefined) params.set('epoch', String(args.epoch))
    return jsonRequest(this.serverUrl, `/v1/sync/pull?${params.toString()}`, {}, accessToken)
  }

  snapshot(accessToken: string): Promise<import('@webwings/sync-protocol').SnapshotPayload> {
    return jsonRequest(this.serverUrl, '/v1/sync/snapshot', {}, accessToken)
  }

  adminList(accessToken: string): Promise<import('@webwings/sync-protocol').AdminKeySummary[]> {
    return jsonRequest(this.serverUrl, '/v1/admin/keys', {}, accessToken)
  }

  adminCreate(accessToken: string, label?: string): Promise<import('@webwings/sync-protocol').AdminCreateKeyResponse> {
    return jsonRequest(this.serverUrl, '/v1/admin/keys', { method: 'POST', body: JSON.stringify(label ? { label } : {}) }, accessToken)
  }

  adminRotate(accessToken: string, keyId: string): Promise<import('@webwings/sync-protocol').AdminRotateKeyResponse> {
    return jsonRequest(this.serverUrl, `/v1/admin/keys/${encodeURIComponent(keyId)}/rotate`, { method: 'POST' }, accessToken)
  }

  adminDelete(accessToken: string, keyId: string): Promise<{ v: 1; status: 'ok' }> {
    return jsonRequest(this.serverUrl, `/v1/admin/keys/${encodeURIComponent(keyId)}/delete`, { method: 'POST' }, accessToken)
  }

  adminRestore(accessToken: string, keyId: string): Promise<import('@webwings/sync-protocol').AdminRotateKeyResponse> {
    return jsonRequest(this.serverUrl, `/v1/admin/keys/${encodeURIComponent(keyId)}/restore`, { method: 'POST' }, accessToken)
  }
}
