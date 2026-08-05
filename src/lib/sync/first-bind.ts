import type { BindCompleteRequest } from '@webwings/sync-protocol'
import { ApiClientError, SyncClient } from './client'
import { buildBackupArchive } from './backup'
import { downloadAndWait } from './download'
import {
  captureLocalSnapshot,
  clearBindSession,
  clearOutbox,
  installSnapshot,
  readBindSession,
  writeBindSession,
  type BindSessionRecord,
} from './local-ops'
import { persistActiveBinding } from './connection'
import { emitLocalChange } from './notify'

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const isBindSessionExpired = (session: BindSessionRecord): boolean =>
  new Date(session.expiresAt).getTime() <= Date.now()

export type BindStrategy = 'initialize_cloud' | 'use_cloud' | 'use_local' | 'merge'

/**
 * Step 1: fetch the locked cloud snapshot, capture a consistent local snapshot
 * and download the `webwings-sync-backup` ZIP. Reconciliation stays disabled
 * until the download reaches the completed state.
 */
export const prepareBackup = async (session: BindSessionRecord): Promise<BindSessionRecord> => {
  const client = new SyncClient(session.serverUrl)
  const cloud = await client.cloudSnapshot(session.bindSessionId, session.bindToken)
  const local = await captureLocalSnapshot()
  const archive = await buildBackupArchive({
    instanceId: session.instanceId,
    keyPrefix: session.keyPrefix,
    cloud,
    local,
  })
  await downloadAndWait(archive.blob, archive.filename)
  const next: BindSessionRecord = {
    ...session,
    step: 'backup_downloaded',
    cloudNodes: cloud.nodes,
    cloudDigest: cloud.digest,
    localNodes: local.nodes,
    localRevision: local.localRevision,
    localDigest: archive.localDigest,
    backupArchiveName: archive.filename,
    downloadedAt: new Date().toISOString(),
    error: null,
  }
  await writeBindSession(next)
  emitLocalChange()
  return next
}

/**
 * Step 2: record backup proof on the server. The server keeps the locked cloud
 * digest and the captured local revision for the bind session.
 */
export const submitBackupProof = async (session: BindSessionRecord): Promise<BindSessionRecord> => {
  const client = new SyncClient(session.serverUrl)
  await client.backupProof(session.bindSessionId, session.bindToken, {
    cloudDigest: session.cloudDigest,
    localDigest: session.localDigest,
    localRevision: session.localRevision,
    downloadState: 'complete',
    downloadedAt: session.downloadedAt ?? new Date().toISOString(),
  })
  const next: BindSessionRecord = { ...session, step: 'backup_proven', error: null }
  await writeBindSession(next)
  emitLocalChange()
  return next
}

export type CompleteResult =
  | { ok: true }
  | { ok: false; reason: 'version_changed' | 'restart_required'; message: string }

/**
 * Step 3: atomically complete the bind with the chosen strategy. Idempotent by
 * operation ID, so retrying after a lost response returns the same result.
 * A 409 version conflict invalidates the session and requires a fresh bind.
 */
export const completeFirstBind = async (session: BindSessionRecord, strategy: BindStrategy): Promise<CompleteResult> => {
  const client = new SyncClient(session.serverUrl)
  const operationId = session.operationId ?? makeId()
  if (!session.operationId) {
    // Persist the operation ID before the network call so a lost response can
    // be retried idempotently with the same operation.
    await writeBindSession({ ...session, operationId })
  }
  const request: BindCompleteRequest = {
    v: 1,
    operationId,
    strategy,
    localNodes: session.localNodes,
    expected: {
      cloudSeq: session.cloud.cloudSeq,
      syncEpoch: session.cloud.syncEpoch,
      localRevision: session.localRevision,
    },
  }
  try {
    const result = await client.bindComplete(session.bindSessionId, session.bindToken, request)
    const { deviceSession, snapshot } = result
    await installSnapshot(snapshot)
    await clearOutbox()
    await persistActiveBinding({
      serverUrl: session.serverUrl,
      instanceId: session.instanceId,
      keyId: session.keyId,
      keyPrefix: session.keyPrefix,
      role: session.role,
      capabilities: session.capabilities,
      deviceId: deviceSession.deviceId,
      refreshToken: deviceSession.refreshToken,
      accessToken: deviceSession.accessToken,
      accessTokenExpiresAt: deviceSession.accessTokenExpiresAt,
      epoch: snapshot.epoch,
      cursor: snapshot.seq,
    })
    await clearBindSession()
    emitLocalChange()
    return { ok: true }
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 409) {
      // Version race or expired/invalid session: keep the operation ID so a
      // fresh backup within the same session can still complete idempotently.
      const invalidated: BindSessionRecord = { ...session, step: 'started', operationId, error: error.message }
      await writeBindSession(invalidated)
      emitLocalChange()
      return { ok: false, reason: 'version_changed', message: error.message }
    }
    throw error
  }
}

/**
 * Retries a version-invalidated bind with a fresh local backup and proof while
 * keeping the same operation ID for idempotency. If the cloud changed during
 * the bind, the locked snapshot can never match and a new bind is required.
 */
export const retryBind = async (session: BindSessionRecord, strategy: BindStrategy): Promise<CompleteResult> => {
  const refreshed = await prepareBackup(session)
  const proven = await submitBackupProof(refreshed)
  const result = await completeFirstBind(proven, strategy)
  if (!result.ok && result.reason === 'version_changed') {
    await clearBindSession()
    emitLocalChange()
    return { ok: false, reason: 'restart_required', message: '云端数据在备份期间发生变化，请重新连接同步服务' }
  }
  return result
}

export const availableStrategies = (session: BindSessionRecord): BindStrategy[] =>
  session.cloud.hasData ? ['use_cloud', 'use_local', 'merge'] : ['initialize_cloud']
