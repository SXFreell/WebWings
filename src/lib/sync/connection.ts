import {
  clearOutbox,
  clearBinding,
  readBinding,
  writeBindSession,
  writeBinding,
  type BindSessionRecord,
  type BindingRecord,
} from './local-ops'
import { emitLocalChange } from './notify'
import { ApiClientError, SyncClient } from './client'
import { discover } from './discovery'
import { hostPermissionOf, normalizeServerUrl, originOf } from './url'

export interface ConnectStart {
  serverUrl: string
  srkey: string
}

export interface CandidateConnection {
  serverUrl: string
  instanceId: string
  keyId: string
  keyPrefix: string
  role: 'admin' | 'sync'
  capabilities: string[]
  bindSessionId: string
  bindToken: string
  expiresAt: string
  cloud: { hasData: boolean; cloudSeq: number; syncEpoch: number }
}

export type ConnectionStep = 'permission' | 'discover' | 'bind' | 'done'

const hasPermission = async (origin: string): Promise<boolean> => {
  if (typeof chrome !== 'undefined' && chrome.permissions?.contains) {
    return chrome.permissions.contains({ origins: [origin] })
  }
  return true
}

/**
 * Asks the browser for the exact target Origin. No network contact happens
 * before permission is granted.
 */
export const ensureOriginPermission = async (serverUrl: string): Promise<{ ok: boolean; reason?: string }> => {
  const origin = originOf(normalizeServerUrl(serverUrl))
  if (await hasPermission(origin)) return { ok: true }
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return { ok: true }
  try {
    const granted = await chrome.permissions.request({ origins: [origin] })
    return granted ? { ok: true } : { ok: false, reason: '未授予服务器访问权限，无法继续连接' }
  } catch {
    return { ok: false, reason: '权限请求失败，请重试' }
  }
}

/**
 * Runs one explicit connect action: exact-Origin permission → discovery →
 * bind/start. The raw srkey is never persisted.
 */
export const startConnection = async (input: ConnectStart): Promise<CandidateConnection> => {
  const serverUrl = normalizeServerUrl(input.serverUrl)
  const permission = await ensureOriginPermission(serverUrl)
  if (!permission.ok) throw new Error(permission.reason ?? '未授予权限')

  const discovered = await discover(serverUrl)
  if (!discovered.ok) throw new Error(discovered.message)

  const client = new SyncClient(serverUrl)
  let started
  try {
    started = await client.bindStart({ srkey: input.srkey.trim(), deviceName: 'WebWings' })
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 401 || error.status === 429)) {
      throw new Error(error.status === 429 ? '尝试次数过多，请稍后再试' : 'Key 无效或已被撤销')
    }
    throw error
  }
  return {
    serverUrl,
    instanceId: discovered.instanceId,
    keyId: started.keyId,
    keyPrefix: started.keyPrefix,
    role: started.role,
    capabilities: started.capabilities,
    bindSessionId: started.bindSessionId,
    bindToken: started.bindToken,
    expiresAt: started.expiresAt,
    cloud: started.cloud,
  }
}

export interface ConnectionIdentity {
  instanceId: string
  keyId: string
}

/**
 * Compares a candidate against the active binding. Same instance+key is an
 * address migration; anything else (different instance or different Key) is a
 * brand-new data space that must run first-bind reconciliation.
 */
export type ConnectionIntent = 'migration' | 'new'

export const resolveConnectionIntent = (candidate: ConnectionIdentity, active: BindingRecord | null): ConnectionIntent => {
  if (active && candidate.instanceId === active.instanceId && candidate.keyId === active.keyId) return 'migration'
  return 'new'
}

export const classifyConnection = resolveConnectionIntent

/**
 * Same-instance URL migration: updates the normalized URL and Origin in place
 * while preserving the device session, tokens, epoch and cursor. The server
 * instance is unchanged, so credentials and state remain valid.
 */
export const migrateActiveBinding = async (active: BindingRecord, candidate: ConnectionIdentity & { serverUrl: string }): Promise<void> => {
  const normalized = normalizeServerUrl(candidate.serverUrl)
  await writeBinding({
    ...active,
    serverUrl: normalized,
    origin: originOf(normalized),
    lastSyncAt: new Date().toISOString(),
  })
  emitLocalChange()
}

/** True when the server behind the current URL no longer matches the binding. */
export const isInstanceMismatch = (binding: BindingRecord, instanceId: string): boolean => binding.instanceId !== instanceId

/** Persists a fresh bind session (never the raw srkey) for the first-bind wizard. */
export const saveCandidateSession = async (candidate: CandidateConnection): Promise<BindSessionRecord> => {
  const session: BindSessionRecord = {
    id: 'active',
    bindSessionId: candidate.bindSessionId,
    serverUrl: candidate.serverUrl,
    origin: originOf(candidate.serverUrl),
    instanceId: candidate.instanceId,
    keyId: candidate.keyId,
    keyPrefix: candidate.keyPrefix,
    role: candidate.role,
    capabilities: candidate.capabilities,
    bindToken: candidate.bindToken,
    expiresAt: candidate.expiresAt,
    cloud: candidate.cloud,
    createdAt: new Date().toISOString(),
    step: 'started',
    cloudNodes: [],
    cloudDigest: '',
    localNodes: [],
    localRevision: 0,
    localDigest: '',
    backupArchiveName: null,
    downloadedAt: null,
    strategy: null,
    operationId: null,
    error: null,
  }
  await writeBindSession(session)
  emitLocalChange()
  return session
}

export interface PersistBindingInput {
  serverUrl: string
  instanceId: string
  keyId: string
  keyPrefix: string
  role: 'admin' | 'sync'
  capabilities: string[]
  deviceId: string
  refreshToken: string
  accessToken: string
  accessTokenExpiresAt: string
  epoch: number
  cursor: number
}

/** Persists only normalized connection data and device credentials. */
export const persistActiveBinding = async (input: PersistBindingInput): Promise<void> => {
  const normalized = normalizeServerUrl(input.serverUrl)
  await writeBinding({
    id: 'active',
    serverUrl: normalized,
    origin: originOf(normalized),
    instanceId: input.instanceId,
    keyId: input.keyId,
    keyPrefix: input.keyPrefix,
    role: input.role,
    capabilities: input.capabilities,
    deviceId: input.deviceId,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    epoch: input.epoch,
    cursor: input.cursor,
    lastSyncAt: new Date().toISOString(),
  })
  emitLocalChange()
}

export const disconnectBinding = async (): Promise<void> => {
  await clearOutbox()
  await clearBinding()
  emitLocalChange()
}

export const requestHostPermission = (serverUrl: string): Promise<{ ok: boolean; reason?: string }> => ensureOriginPermission(serverUrl)
export const syncClientFor = (binding: BindingRecord): SyncClient => new SyncClient(binding.serverUrl)
export { hostPermissionOf }
