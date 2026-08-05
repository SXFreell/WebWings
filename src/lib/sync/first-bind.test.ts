import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudSnapshot, SnapshotPayload, SyncNode } from '@webwings/sync-protocol'
import { getAllNodes } from '../bookmarks-db'
import { localCreateNode } from './local-ops'
import { readBindSession, readBinding, writeBindSession, type BindSessionRecord } from './local-ops'
import { completeFirstBind, prepareBackup, submitBackupProof } from './first-bind'

const now = () => '2026-08-05T00:00:00.000Z'

const node = (id: string, overrides: Partial<SyncNode> = {}): SyncNode => ({
  id,
  type: 'bookmark',
  parentId: null,
  title: id,
  url: 'https://example.com',
  positionKey: '1000',
  createdAt: now(),
  updatedAt: now(),
  version: 1,
  deletedAt: null,
  recoveryReason: null,
  ...overrides,
})

const sessionBase = (overrides: Partial<BindSessionRecord> = {}): BindSessionRecord => ({
  id: 'active',
  bindSessionId: 'bind-1',
  serverUrl: 'https://sync.example.com',
  origin: 'https://sync.example.com',
  instanceId: 'srv_1',
  keyId: 'key-1',
  keyPrefix: 'srk_sync_ab',
  role: 'sync',
  capabilities: ['sync'],
  bindToken: 'bind-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  cloud: { hasData: false, cloudSeq: 0, syncEpoch: 1 },
  createdAt: now(),
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
  ...overrides,
})

const deviceSession = {
  deviceId: 'dev-1',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
}

const snapshot = (nodes: SyncNode[], epoch = 1, seq = 1): SnapshotPayload => ({
  v: 1,
  epoch,
  seq,
  digest: 'd'.repeat(64),
  nodes,
})

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

interface ServerStub {
  cloud?: CloudSnapshot
  proofResponses?: Array<{ ok: boolean; status: number }>
  completeResponses?: Array<{ ok: boolean; status: number; body?: unknown }>
  downloadState?: 'complete' | 'interrupted'
}

const stubServer = (stub: ServerStub) => {
  const proofResponses = stub.proofResponses ?? [{ ok: true, status: 200 }]
  const completeResponses = stub.completeResponses ?? [{ ok: true, status: 200, body: { v: 1, deviceSession, snapshot: snapshot(stub.cloud?.nodes ?? [], stub.cloud?.syncEpoch ?? 1, (stub.cloud?.cloudSeq ?? 0) + 1) } }]
  const calls = { proof: 0, complete: 0 }
  const completeBodies: Array<{ operationId?: string; strategy?: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/cloud-snapshot')) {
      return { ok: true, status: 200, json: async () => stub.cloud ?? { v: 1, bindSessionId: 'bind-1', cloudSeq: 0, syncEpoch: 1, digest: 'e'.repeat(64), nodes: [] } }
    }
    if (url.includes('/backup-proof')) {
      const response = proofResponses[Math.min(calls.proof, proofResponses.length - 1)]
      calls.proof += 1
      return { ok: response.ok, status: response.status, json: async () => ({ error: { code: 'unauthorized', message: 'revoked' } }) }
    }
    if (url.includes('/complete')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      completeBodies.push(body)
      const response = completeResponses[Math.min(calls.complete, completeResponses.length - 1)]
      calls.complete += 1
      if (!response.ok) {
        return { ok: false, status: response.status, json: async () => ({ error: { code: 'version_changed', message: response.body ?? 'versions changed' } }) }
      }
      return { ok: true, status: 200, json: async () => response.body }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as unknown as typeof fetch)
  vi.stubGlobal('chrome', {
    downloads: {
      download: vi.fn(async () => 1),
      search: vi.fn(async () => [{ id: 1, state: stub.downloadState ?? 'complete' }]),
    },
  })
  return { calls, completeBodies }
}

describe('first bind flow', () => {
  beforeEach(deleteDatabase)
  afterEach(() => vi.unstubAllGlobals())

  it('initializes an empty cloud from empty local data (empty/empty)', async () => {
    const server = stubServer({ cloud: { v: 1, bindSessionId: 'bind-1', cloudSeq: 0, syncEpoch: 1, digest: 'e'.repeat(64), nodes: [] } })
    await writeBindSession(sessionBase())

    const backedUp = await prepareBackup((await readBindSession())!)
    expect(backedUp.step).toBe('backup_downloaded')
    expect(backedUp.backupArchiveName).toMatch(/webwings-sync-backup-.*\.zip/)

    const proven = await submitBackupProof((await readBindSession())!)
    expect(proven.step).toBe('backup_proven')

    const result = await completeFirstBind((await readBindSession())!, 'initialize_cloud')
    expect(result).toEqual({ ok: true })
    const binding = await readBinding()
    expect(binding?.deviceId).toBe('dev-1')
    expect(binding?.epoch).toBe(1)
    expect(binding?.cursor).toBe(1)
    expect(await readBindSession()).toBeUndefined()
    expect(server.completeBodies[0]).toMatchObject({ strategy: 'initialize_cloud', operationId: expect.any(String) })
  })

  it('initializes an empty cloud from local data (empty/local)', async () => {
    stubServer({
      cloud: { v: 1, bindSessionId: 'bind-1', cloudSeq: 0, syncEpoch: 1, digest: 'e'.repeat(64), nodes: [] },
      completeResponses: [{ ok: true, status: 200, body: { v: 1, deviceSession, snapshot: snapshot([node('local-1')], 1, 1) } }],
    })
    await writeBindSession(sessionBase())
    await localCreateNode({
      id: 'local-1',
      type: 'bookmark',
      parentId: null,
      title: 'local bookmark',
      url: 'https://local.example',
      createdAt: now(),
      updatedAt: now(),
    })

    await prepareBackup((await readBindSession())!)
    await submitBackupProof((await readBindSession())!)
    const result = await completeFirstBind((await readBindSession())!, 'initialize_cloud')
    expect(result.ok).toBe(true)
    expect((await readBinding())?.deviceId).toBe('dev-1')
    expect(await getAllNodes()).toHaveLength(1)
  })

  it('use_cloud installs the cloud snapshot and discards local nodes', async () => {
    stubServer({
      cloud: { v: 1, bindSessionId: 'bind-1', cloudSeq: 7, syncEpoch: 1, digest: 'e'.repeat(64), nodes: [node('cloud-1')] },
      completeResponses: [{ ok: true, status: 200, body: { v: 1, deviceSession, snapshot: snapshot([node('cloud-1')], 1, 7) } }],
    })
    await writeBindSession(sessionBase({ cloud: { hasData: true, cloudSeq: 7, syncEpoch: 1 } }))
    await localCreateNode({
      id: 'local-1',
      type: 'bookmark',
      parentId: null,
      title: 'local',
      url: 'https://local.example',
      createdAt: now(),
      updatedAt: now(),
    })

    await prepareBackup((await readBindSession())!)
    await submitBackupProof((await readBindSession())!)
    const result = await completeFirstBind((await readBindSession())!, 'use_cloud')
    expect(result.ok).toBe(true)
    const nodes = await getAllNodes()
    expect(nodes.map((n) => n.id)).toEqual(['cloud-1'])
    expect((await readBinding())?.cursor).toBe(7)
  })

  it('use_local installs local data with a bumped epoch', async () => {
    stubServer({
      cloud: { v: 1, bindSessionId: 'bind-1', cloudSeq: 7, syncEpoch: 1, digest: 'e'.repeat(64), nodes: [node('cloud-1')] },
      completeResponses: [{ ok: true, status: 200, body: { v: 1, deviceSession, snapshot: snapshot([node('local-1')], 2, 8) } }],
    })
    await writeBindSession(sessionBase({ cloud: { hasData: true, cloudSeq: 7, syncEpoch: 1 } }))
    await localCreateNode({
      id: 'local-1',
      type: 'bookmark',
      parentId: null,
      title: 'local',
      url: 'https://local.example',
      createdAt: now(),
      updatedAt: now(),
    })

    await prepareBackup((await readBindSession())!)
    await submitBackupProof((await readBindSession())!)
    const result = await completeFirstBind((await readBindSession())!, 'use_local')
    expect(result.ok).toBe(true)
    const nodes = await getAllNodes()
    expect(nodes.map((n) => n.id)).toEqual(['local-1'])
    expect((await readBinding())?.epoch).toBe(2)
  })

  it('merge keeps cloud nodes and appends local nodes', async () => {
    const server = stubServer({
      cloud: { v: 1, bindSessionId: 'bind-1', cloudSeq: 7, syncEpoch: 1, digest: 'e'.repeat(64), nodes: [node('cloud-1')] },
      completeResponses: [{ ok: true, status: 200, body: { v: 1, deviceSession, snapshot: snapshot([node('cloud-1'), node('local-1')], 1, 8) } }],
    })
    await writeBindSession(sessionBase({ cloud: { hasData: true, cloudSeq: 7, syncEpoch: 1 } }))
    await localCreateNode({
      id: 'local-1',
      type: 'bookmark',
      parentId: null,
      title: 'local',
      url: 'https://local.example',
      createdAt: now(),
      updatedAt: now(),
    })

    await prepareBackup((await readBindSession())!)
    await submitBackupProof((await readBindSession())!)
    const result = await completeFirstBind((await readBindSession())!, 'merge')
    expect(result.ok).toBe(true)
    expect((await getAllNodes()).map((n) => n.id).sort()).toEqual(['cloud-1', 'local-1'])
    expect(server.completeBodies[0]?.strategy).toBe('merge')
  })

  it('keeps reconciliation disabled when the download fails', async () => {
    const server = stubServer({ downloadState: 'interrupted', completeResponses: [] })
    await writeBindSession(sessionBase())
    await expect(prepareBackup((await readBindSession())!)).rejects.toThrow('下载失败')
    expect(server.calls.complete).toBe(0)
    expect((await readBindSession())?.step).toBe('started')
  })

  it('retries a version race with a fresh backup and the same operation id', async () => {
    const server = stubServer({
      cloud: { v: 1, bindSessionId: 'bind-1', cloudSeq: 7, syncEpoch: 1, digest: 'e'.repeat(64), nodes: [node('cloud-1')] },
      proofResponses: [{ ok: true, status: 200 }],
      completeResponses: [
        { ok: false, status: 409, body: 'cloud versions changed' },
        { ok: true, status: 200, body: { v: 1, deviceSession, snapshot: snapshot([node('cloud-1'), node('local-1')], 1, 8) } },
      ],
    })
    await writeBindSession(sessionBase({ cloud: { hasData: true, cloudSeq: 7, syncEpoch: 1 } }))
    await localCreateNode({
      id: 'local-1',
      type: 'bookmark',
      parentId: null,
      title: 'local',
      url: 'https://local.example',
      createdAt: now(),
      updatedAt: now(),
    })

    await prepareBackup((await readBindSession())!)
    await submitBackupProof((await readBindSession())!)
    const first = await completeFirstBind((await readBindSession())!, 'merge')
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.reason).toBe('version_changed')
    const invalidated = await readBindSession()
    expect(invalidated?.step).toBe('started')
    expect(invalidated?.operationId).toBeTruthy()

    await prepareBackup(invalidated!)
    await submitBackupProof((await readBindSession())!)
    const second = await completeFirstBind((await readBindSession())!, 'merge')
    expect(second.ok).toBe(true)
    expect(server.completeBodies[0]?.operationId).toBe(server.completeBodies[1]?.operationId)
  })

  it('retries idempotently after a lost response using the persisted operation id', async () => {
    const completeBodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/cloud-snapshot')) {
        return { ok: true, status: 200, json: async () => ({ v: 1, bindSessionId: 'bind-1', cloudSeq: 0, syncEpoch: 1, digest: 'e'.repeat(64), nodes: [] }) }
      }
      if (url.includes('/backup-proof')) return { ok: true, status: 200, json: async () => ({ v: 1, status: 'ok' }) }
      if (url.includes('/complete')) {
        completeBodies.push(String(init?.body))
        if (completeBodies.length === 1) throw new TypeError('network dropped')
        return { ok: true, status: 200, json: async () => ({ v: 1, deviceSession, snapshot: snapshot([], 1, 1) }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch)
    vi.stubGlobal('chrome', { downloads: { download: vi.fn(async () => 1), search: vi.fn(async () => [{ id: 1, state: 'complete' }]) } })

    await writeBindSession(sessionBase())
    await prepareBackup((await readBindSession())!)
    await submitBackupProof((await readBindSession())!)
    await expect(completeFirstBind((await readBindSession())!, 'initialize_cloud')).rejects.toThrow('无法连接')
    const retried = await completeFirstBind((await readBindSession())!, 'initialize_cloud')
    expect(retried.ok).toBe(true)
    const firstOp = JSON.parse(completeBodies[0]).operationId as string
    const secondOp = JSON.parse(completeBodies[1]).operationId as string
    expect(firstOp).toBe(secondOp)
  })

  it('surfaces Key revocation during backup proof without touching local data', async () => {
    stubServer({ proofResponses: [{ ok: false, status: 401 }] })
    await writeBindSession(sessionBase())
    await localCreateNode({
      id: 'local-1',
      type: 'bookmark',
      parentId: null,
      title: 'local',
      url: 'https://local.example',
      createdAt: now(),
      updatedAt: now(),
    })

    await prepareBackup((await readBindSession())!)
    await expect(submitBackupProof((await readBindSession())!)).rejects.toThrow()
    expect((await readBindSession())?.step).toBe('backup_downloaded')
    expect(await getAllNodes()).toHaveLength(1)
  })
})
