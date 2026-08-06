import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperationReceipt, SyncEvent } from '@webwings/sync-protocol'
import { getAllNodes } from '../bookmarks-db'
import { nextBackoffAt, triggerSync } from './engine'
import {
  localCreateNode,
  readBinding,
  readMeta,
  readOutbox,
  readSyncStatus,
  writeBinding,
  writeSyncStatus,
  type BindingRecord,
} from './local-ops'

const nowIso = '2026-08-05T00:00:00.000Z'

const binding = (overrides: Partial<BindingRecord> = {}): BindingRecord => ({
  id: 'active',
  serverUrl: 'https://sync.example.com',
  origin: 'https://sync.example.com',
  instanceId: 'srv_1',
  keyId: 'key-1',
  keyPrefix: 'srk_sync_ab',
  role: 'sync',
  capabilities: ['sync'],
  deviceId: 'dev-1',
  refreshToken: 'refresh-1',
  accessToken: 'access-1',
  accessTokenExpiresAt: '2099-01-01T00:00:00Z',
  epoch: 1,
  cursor: 0,
  lastSyncAt: null,
  ...overrides,
})

const event = (id: string, seq: number, type: SyncEvent['type'], payload: unknown): SyncEvent => ({
  syncEpoch: 1,
  seq,
  opId: `op-${id}-${seq}`,
  deviceId: 'dev-2',
  type,
  payload,
  createdAt: nowIso,
})

const createdEvent = (id: string, seq: number) => event(id, seq, 'created', {
  node: {
    id,
    type: 'bookmark',
    parentId: null,
    title: id,
    url: 'https://example.com',
    positionKey: '0000000000000000000000000000000000001000',
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
    deletedAt: null,
    recoveryReason: null,
  },
})

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

interface EngineServer {
  pulls: Array<{ status: 'ok'; epoch: number; currentSeq: number; events: SyncEvent[] } | { status: 'snapshot_required'; epoch: number; currentSeq: number; snapshotSeq: number }>
  receipts?: OperationReceipt[]
  snapshotNodes?: unknown[]
  pushBehavior?: 'network_error' | 'ok'
  instanceId?: string
  refreshStatus?: number
}

const stubServer = (stub: EngineServer) => {
  const callCounts = { pull: 0, push: 0, info: 0, refresh: 0, snapshot: 0 }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    callCounts.info += url.includes('/v1/info') ? 1 : 0
    callCounts.refresh += url.includes('/auth/refresh') ? 1 : 0
    callCounts.snapshot += url.includes('/sync/snapshot') ? 1 : 0
    if (url.includes('/v1/info')) {
      return { ok: true, status: 200, json: async () => ({
        service: 'webwings-sync',
        apiVersion: 1,
        instanceId: stub.instanceId ?? 'srv_1',
        serverTime: nowIso,
        minClientVersion: '1.0.0',
        features: ['sync', 'realtime'],
      }) }
    }
    if (url.includes('/auth/refresh')) {
      callCounts.refresh = callCounts.refresh
      if (stub.refreshStatus && stub.refreshStatus >= 400) {
        return { ok: false, status: stub.refreshStatus, json: async () => ({ error: { code: 'unauthorized', message: 'revoked' } }) }
      }
      return { ok: true, status: 200, json: async () => ({
        deviceId: 'dev-1',
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        accessTokenExpiresAt: '2099-01-01T00:00:00Z',
        refreshTokenExpiresAt: '2099-01-01T00:00:00Z',
      }) }
    }
    if (url.includes('/sync/pull')) {
      const index = Math.min(callCounts.pull, stub.pulls.length - 1)
      callCounts.pull += 1
      const response = stub.pulls[index]
      return { ok: true, status: 200, json: async () => ({ v: 1, ...response }) }
    }
    if (url.includes('/sync/push')) {
      callCounts.push += 1
      if (stub.pushBehavior === 'network_error') throw new TypeError('connection reset')
      return { ok: true, status: 200, json: async () => ({ v: 1, receipts: stub.receipts ?? [] }) }
    }
    if (url.includes('/sync/snapshot')) {
      return { ok: true, status: 200, json: async () => ({
        v: 1,
        epoch: 1,
        seq: 2,
        digest: 'f'.repeat(64),
        nodes: stub.snapshotNodes ?? [],
      }) }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as unknown as typeof fetch)
  vi.stubGlobal('chrome', {
    permissions: { contains: vi.fn(async () => true) },
    runtime: { sendMessage: vi.fn(async () => undefined) },
  })
  return callCounts
}

describe('sync engine', () => {
  beforeEach(deleteDatabase)
  afterEach(() => vi.unstubAllGlobals())

  it('pulls first, applies remote events, pushes outbox and converges without duplicates', async () => {
    await writeBinding(binding())
    await localCreateNode({
      id: 'a',
      type: 'bookmark',
      parentId: null,
      title: 'a',
      url: 'https://a.example',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    const opId = (await readOutbox())[0].op.opId
    const calls = stubServer({
      pulls: [
        { status: 'ok', epoch: 1, currentSeq: 1, events: [createdEvent('b', 1)] },
        { status: 'ok', epoch: 1, currentSeq: 2, events: [createdEvent('a', 2)] },
      ],
      receipts: [{ opId, status: 'accepted', seq: 2 }],
    })

    await triggerSync('test')

    const nodes = await getAllNodes()
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(await readOutbox()).toHaveLength(0)
    expect((await readMeta())?.cursor).toBe(2)
    expect(calls.pull).toBe(2)
    expect(calls.push).toBe(1)
    expect((await readBinding())?.lastSyncAt).toBeTruthy()
    expect((await readSyncStatus())?.state).toBe('ok')
  })

  it('keeps the outbox intact when the network fails before sending', async () => {
    stubServer({
      pulls: [{ status: 'ok', epoch: 1, currentSeq: 1, events: [] }],
      pushBehavior: 'network_error',
    })
    await writeBinding(binding())
    await localCreateNode({
      id: 'a',
      type: 'bookmark',
      parentId: null,
      title: 'a',
      url: 'https://a.example',
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch)
    await triggerSync('test')

    expect((await readSyncStatus())?.state).toBe('offline')
    expect(await readOutbox()).toHaveLength(1)
    expect(await getAllNodes()).toHaveLength(1)
  })

  it('drops an outbox op only after the receipt is persisted; retries after a lost response', async () => {
    await writeBinding(binding())
    await localCreateNode({
      id: 'a',
      type: 'bookmark',
      parentId: null,
      title: 'a',
      url: 'https://a.example',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    const opId = (await readOutbox())[0].op.opId
    let pushAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/v1/info')) {
        return { ok: true, status: 200, json: async () => ({ service: 'webwings-sync', apiVersion: 1, instanceId: 'srv_1', serverTime: nowIso, minClientVersion: '1.0.0', features: [] }) }
      }
      if (url.includes('/sync/pull')) return { ok: true, status: 200, json: async () => ({ v: 1, status: 'ok', epoch: 1, currentSeq: 0, events: [] }) }
      if (url.includes('/sync/push')) {
        pushAttempts += 1
        if (pushAttempts === 1) throw new TypeError('response lost after server applied')
        return { ok: true, status: 200, json: async () => ({ v: 1, receipts: [{ opId, status: 'accepted', seq: 1 }] }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch)
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true) }, runtime: { sendMessage: vi.fn() } })
    await triggerSync('first')
    expect(await readOutbox()).toHaveLength(1)
    // The alarm fires after the backoff window elapses.
    await writeSyncStatus({ ...(await readSyncStatus())!, nextRetryAt: null })
    await triggerSync('retry')
    expect(await readOutbox()).toHaveLength(0)
    expect(pushAttempts).toBe(2)
  })

  it('recovers from snapshot_required, keeps epoch-valid ops and drops stale ones', async () => {
    await writeBinding(binding())
    await localCreateNode({
      id: 'from-outbox',
      type: 'bookmark',
      parentId: null,
      title: 'from-outbox',
      url: 'https://x.example',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    const opId = (await readOutbox())[0].op.opId
    const calls = stubServer({
      pulls: [
        { status: 'snapshot_required', epoch: 1, currentSeq: 2, snapshotSeq: 2 },
        { status: 'ok', epoch: 1, currentSeq: 3, events: [createdEvent('from-outbox', 3)] },
      ],
      snapshotNodes: [(createdEvent('s1', 2).payload as { node: unknown }).node],
      receipts: [{ opId, status: 'accepted', seq: 3 }],
    })

    await triggerSync('test')
    expect(calls.snapshot).toBe(1)
    const nodes = await getAllNodes()
    expect(nodes.map((n) => n.id).sort()).toEqual(['from-outbox', 's1'])
    expect(await readOutbox()).toHaveLength(0)
  })

  it('clears the outbox and reinstalls the snapshot on epoch_mismatch receipts', async () => {
    await writeBinding(binding())
    await localCreateNode({
      id: 'stale',
      type: 'bookmark',
      parentId: null,
      title: 'stale',
      url: 'https://stale.example',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    const opId = (await readOutbox())[0].op.opId
    stubServer({
      pulls: [
        { status: 'ok', epoch: 1, currentSeq: 5, events: [] },
        { status: 'ok', epoch: 1, currentSeq: 5, events: [] },
      ],
      snapshotNodes: [(createdEvent('s1', 5).payload as { node: unknown }).node],
      receipts: [{ opId, status: 'epoch_mismatch', seq: null, errorCode: 'epoch_mismatch' }],
    })

    await triggerSync('test')
    expect(await readOutbox()).toHaveLength(0)
    expect((await getAllNodes()).map((n) => n.id).sort()).toEqual(['s1'])
  })

  it('refreshes expired tokens before pulling and rotates the persisted tokens', async () => {
    const calls = stubServer({
      pulls: [{ status: 'ok', epoch: 1, currentSeq: 0, events: [] }],
    })
    await writeBinding(binding({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' }))
    await triggerSync('test')
    expect(calls.refresh).toBeGreaterThan(0)
    const stored = await readBinding()
    expect(stored?.accessToken).toBe('access-2')
    expect(stored?.refreshToken).toBe('refresh-2')
  })

  it('pauses with auth_failed when the refresh token is terminal', async () => {
    stubServer({ refreshStatus: 401, pulls: [{ status: 'ok', epoch: 1, currentSeq: 0, events: [] }] })
    await writeBinding(binding({ accessTokenExpiresAt: '2020-01-01T00:00:00Z' }))
    await triggerSync('test')
    expect((await readSyncStatus())?.state).toBe('auth_failed')
  })

  it('pauses without contacting the server when permission is missing', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const contains = vi.fn(async () => false)
    vi.stubGlobal('chrome', { permissions: { contains }, runtime: { sendMessage: vi.fn() } })
    await writeBinding(binding({ serverUrl: 'http://localhost:8787', origin: 'http://localhost:8787' }))
    await triggerSync('test')
    expect((await readSyncStatus())?.state).toBe('permission_missing')
    expect(contains).toHaveBeenCalledWith({ origins: ['http://localhost:8787/*'] })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('pauses uploads when the instance identity changes', async () => {
    const calls = stubServer({ instanceId: 'srv_other', pulls: [{ status: 'ok', epoch: 1, currentSeq: 0, events: [] }] })
    await writeBinding(binding())
    await localCreateNode({
      id: 'a',
      type: 'bookmark',
      parentId: null,
      title: 'a',
      url: 'https://a.example',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await triggerSync('test')
    expect((await readSyncStatus())?.state).toBe('instance_changed')
    expect(calls.pull).toBe(0)
    expect(calls.push).toBe(0)
    expect(await readOutbox()).toHaveLength(1)
  })

  it('backs off with jittered exponential delays', () => {
    const first = Date.parse(nextBackoffAt(0, 1_000))
    const second = Date.parse(nextBackoffAt(1, 1_000))
    expect(first).toBeGreaterThanOrEqual(1_000 + 30_000)
    expect(second).toBeGreaterThanOrEqual(1_000 + 60_000)
  })
})
