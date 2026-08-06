import { ApiClientError, SyncClient } from './client'
import { discover } from './discovery'
import { isInstanceMismatch } from './connection'
import {
  applyRemoteEvents,
  defaultMeta,
  installSnapshot,
  readBinding,
  readMeta,
  readOutbox,
  readSyncStatus,
  replaceOutbox,
  writeBinding,
  writeSyncStatus,
  type BindingRecord,
  type OutboxEntry,
  type SyncState,
} from './local-ops'
import { emitLocalChange } from './notify'
import { hostPermissionOf } from './url'

const nowIso = () => new Date().toISOString()
const PUSH_BATCH_LIMIT = 200

let running = false
let followUp = false

const defaultStatus = () => ({
  id: 'syncStatus' as const,
  state: 'idle' as const,
  message: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextRetryAt: null,
  attempts: 0,
})

const setStatus = async (
  state: SyncState,
  message: string | null,
  overrides: Partial<{ lastSuccessAt: string; nextRetryAt: string | null; attempts: number }> = {},
) => {
  const previous = (await readSyncStatus()) ?? defaultStatus()
  await writeSyncStatus({
    ...previous,
    state,
    message,
    lastAttemptAt: nowIso(),
    ...overrides,
  })
  emitLocalChange()
}

/** Requests one sync pass. Serialized: a pass in flight defers the next one. */
export const triggerSync = async (reason: string): Promise<void> => {
  if (running) {
    followUp = true
    return
  }
  running = true
  try {
    await runCycle(reason)
  } finally {
    running = false
  }
  if (followUp) {
    followUp = false
    void triggerSync('followup')
  }
}

const runCycle = async (reason: string): Promise<void> => {
  const binding = await readBinding()
  if (!binding) return
  void reason
  const before = (await readSyncStatus()) ?? defaultStatus()
  if (before.nextRetryAt && Date.parse(before.nextRetryAt) > Date.now()) return
  await setStatus('syncing', null)
  try {
    const hostPattern = hostPermissionOf(binding.serverUrl)
    const hasPermission =
      typeof chrome === 'undefined' || !chrome.permissions?.contains
        ? true
        : await chrome.permissions.contains({ origins: [hostPattern] })
    if (!hasPermission) {
      await setStatus('permission_missing', '已撤销服务器访问权限，同步已暂停')
      return
    }
    const discovered = await discover(binding.serverUrl)
    if (!discovered.ok) {
      await setStatus(discovered.code === 'network' ? 'offline' : 'stalled', discovered.message)
      return
    }
    if (isInstanceMismatch(binding, discovered.instanceId)) {
      await setStatus('instance_changed', '服务器实例已改变，已暂停上传，请重新连接')
      return
    }
    const client = new SyncClient(binding.serverUrl)
    const access = await getFreshAccessToken(binding, client)
    if (!access.ok) {
      await setStatus(access.state, access.message)
      return
    }
    await pullThenPush(client, access.token)
    const current = (await readBinding()) ?? binding
    await writeBinding({ ...current, lastSyncAt: nowIso() })
    await setStatus('ok', null, { lastSuccessAt: nowIso(), nextRetryAt: null, attempts: 0 })
  } catch (error) {
    const attempts = before.attempts + 1
    const nextRetryAt = nextBackoffAt(attempts)
    if (error instanceof ApiClientError && error.status === 0) {
      await setStatus('offline', '无法连接到同步服务，稍后自动重试', { nextRetryAt, attempts })
    } else if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
      await setStatus('auth_failed', error.message, { nextRetryAt, attempts })
    } else {
      await setStatus('stalled', error instanceof Error ? error.message : '同步失败，稍后重试', { nextRetryAt, attempts })
    }
  }
}

export const getFreshAccessToken = async (
  binding: BindingRecord,
  client: SyncClient,
): Promise<{ ok: true; token: string } | { ok: false; state: Extract<SyncState, 'auth_failed'>; message: string }> => {
  const expiresInFuture = binding.accessTokenExpiresAt && Date.parse(binding.accessTokenExpiresAt) > Date.now() + 60_000
  if (binding.accessToken && expiresInFuture) return { ok: true, token: binding.accessToken }
  try {
    const issued = await client.refresh(binding.refreshToken)
    await writeBinding({
      ...binding,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt,
    })
    return { ok: true, token: issued.accessToken }
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return { ok: false, state: 'auth_failed', message: '登录已失效（Key 可能已被轮换或删除），请重新连接' }
    }
    throw error
  }
}

/** Pull-first cycle: apply remote events, push outbox, then pull the echoes. */
const pullThenPush = async (client: SyncClient, token: string): Promise<void> => {
  const meta = (await readMeta()) ?? defaultMeta()
  const first = await client.pull(token, { after: meta.cursor, epoch: meta.epoch, limit: 500 })
  if (first.status === 'snapshot_required') {
    await recoverFromSnapshot(client, token)
  } else {
    await applyRemoteEvents(first.events, first.currentSeq, first.epoch)
    await pushOutbox(client, token)
  }
  const refreshed = (await readMeta()) ?? defaultMeta()
  const second = await client.pull(token, { after: refreshed.cursor, epoch: refreshed.epoch, limit: 500 })
  if (second.status === 'ok') {
    await applyRemoteEvents(second.events, second.currentSeq, second.epoch)
  }
}

/** Snapshot recovery: install the canonical tree, drop stale-epoch ops, replay valid ones. */
const recoverFromSnapshot = async (client: SyncClient, token: string): Promise<void> => {
  const snapshot = await client.snapshot(token)
  await installSnapshot(snapshot)
  const outbox = await readOutbox()
  const valid = outbox.filter((entry) => entry.op.syncEpoch === snapshot.epoch)
  const dropped = outbox.length - valid.length
  if (dropped > 0) await replaceOutbox(valid)
  await pushOutbox(client, token)
}

/**
 * Pushes the oldest outbox operations in batches and processes receipts:
 * accepted ops leave the queue, rejected ops are dropped and their corrective
 * state is picked up by the follow-up pull. epoch_mismatch receipts invalidate
 * the whole stale queue.
 */
const pushOutbox = async (client: SyncClient, token: string): Promise<void> => {
  const outbox = await readOutbox()
  if (outbox.length === 0) return
  const batch = outbox.slice(0, PUSH_BATCH_LIMIT)
  const response = await client.push(token, batch.map((entry) => entry.op))
  const receipts = new Map(response.receipts.map((receipt) => [receipt.opId, receipt]))
  const batchIds = new Set(batch.map((entry) => entry.op.opId))
  const keep: OutboxEntry[] = []
  let epochMismatch = false
  for (const entry of outbox) {
    if (!batchIds.has(entry.op.opId)) {
      keep.push(entry)
      continue
    }
    const receipt = receipts.get(entry.op.opId)
    if (!receipt) {
      keep.push(entry)
      continue
    }
    if (receipt.status === 'accepted') continue
    if (receipt.status === 'epoch_mismatch') {
      epochMismatch = true
      continue
    }
    // rejected: the server state is authoritative; drop the optimistic op.
  }
  if (epochMismatch) {
    // Old-epoch ops can never succeed; the next pull will demand a snapshot.
    await replaceOutbox([])
    await recoverFromSnapshot(client, token)
    return
  }
  await replaceOutbox(keep)
}

/** Computes the next retry deadline with jittered exponential backoff. */
export const nextBackoffAt = (attempt: number, nowMs = Date.now()): string => {
  const baseMs = 30_000 * 2 ** Math.min(attempt, 5)
  const jitter = Math.floor(Math.random() * baseMs * 0.5)
  return new Date(nowMs + baseMs + jitter).toISOString()
}
