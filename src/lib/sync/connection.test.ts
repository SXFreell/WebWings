import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAllNodes } from '../bookmarks-db'
import { readBindSession, readBinding, writeBinding } from './local-ops'
import {
  classifyConnection,
  disconnectBinding,
  ensureOriginPermission,
  isInstanceMismatch,
  migrateActiveBinding,
  persistActiveBinding,
  saveCandidateSession,
  startConnection,
  type CandidateConnection,
} from './connection'

const validInfo = {
  service: 'webwings-sync',
  apiVersion: 1,
  instanceId: 'srv_1',
  serverTime: new Date().toISOString(),
  minClientVersion: '1.0.0',
  features: ['sync', 'realtime'],
}

const bindStartBody = {
  v: 1,
  bindSessionId: 'bind-1',
  bindToken: 'bind-token',
  expiresAt: '2099-01-01T00:00:00Z',
  keyId: 'key-1',
  keyPrefix: 'srk_sync_ab',
  role: 'sync',
  capabilities: ['sync'],
  cloud: { hasData: false, cloudSeq: 0, syncEpoch: 1 },
}

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

const grantPermission = () => {
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    runtime: { sendMessage: vi.fn(async () => undefined) },
  })
}

const stubFetchSequence = (responses: Array<{ ok: boolean; status: number; body: unknown }>) => {
  let index = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return { ok: response.ok, status: response.status, json: async () => response.body } as unknown as Response
  }))
}

describe('connection flow', () => {
  beforeEach(deleteDatabase)
  afterEach(() => vi.unstubAllGlobals())

  it('runs permission → discovery → bind and never persists the raw srkey', async () => {
    grantPermission()
    stubFetchSequence([
      { ok: true, status: 200, body: validInfo },
      { ok: true, status: 200, body: bindStartBody },
    ])
    const candidate = await startConnection({ serverUrl: 'https://sync.example.com', srkey: 'srk_sync_abcdefghijklmnopqrstuvwxyz0123456789ab' })
    expect(candidate.instanceId).toBe('srv_1')
    expect(candidate.bindToken).toBe('bind-token')
    const fetchCalls = vi.mocked(fetch).mock.calls
    expect(fetchCalls[0][0]).toContain('/v1/info')
    expect(fetchCalls[1][0]).toContain('/v1/bind/start')
    const bindBody = JSON.parse(String(fetchCalls[1][1]?.body))
    expect(bindBody.srkey).toContain('srk_sync_')
  })

  it('fails before srkey submission when discovery rejects the service', async () => {
    grantPermission()
    stubFetchSequence([{ ok: true, status: 200, body: { ...validInfo, service: 'other' } }])
    await expect(startConnection({ serverUrl: 'https://sync.example.com', srkey: 'srk_sync_x' })).rejects.toThrow('不是 WebWings')
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toContain('/v1/info')
    expect(JSON.stringify(calls[0][1]?.body ?? '')).not.toContain('srk_')
  })

  it('keeps the active binding and local data untouched on connection failure', async () => {
    grantPermission()
    await persistActiveBinding({
      serverUrl: 'https://sync.example.com',
      instanceId: 'srv_1',
      keyId: 'key-1',
      keyPrefix: 'srk_sync_ab',
      role: 'sync',
      capabilities: ['sync'],
      deviceId: 'dev-1',
      refreshToken: 'refresh',
      accessToken: 'access',
      accessTokenExpiresAt: '2099-01-01T00:00:00Z',
      epoch: 1,
      cursor: 0,
    })
    const before = await readBinding()
    stubFetchSequence([{ ok: false, status: 500, body: { error: { code: 'internal_error', message: 'boom' } } }])
    await expect(startConnection({ serverUrl: 'https://other.example', srkey: 'srk_sync_x' })).rejects.toBeTruthy()
    expect(await readBinding()).toEqual(before)
    expect(await getAllNodes()).toEqual([])
  })

  it('classifies same instance+key as a migration and different identity as new', () => {
    expect(classifyConnection({ instanceId: 'srv_1', keyId: 'key-1' }, null)).toBe('new')
    const active = { instanceId: 'srv_1', keyId: 'key-1' }
    expect(classifyConnection({ instanceId: 'srv_1', keyId: 'key-1' }, active as never)).toBe('migration')
    expect(classifyConnection({ instanceId: 'srv_1', keyId: 'key-2' }, active as never)).toBe('new')
    expect(classifyConnection({ instanceId: 'srv_2', keyId: 'key-1' }, active as never)).toBe('new')
  })

  it('migrates the server URL in place when the instance and key match', async () => {
    await persistActiveBinding({
      serverUrl: 'https://old.example',
      instanceId: 'srv_1',
      keyId: 'key-1',
      keyPrefix: 'srk_sync_ab',
      role: 'sync',
      capabilities: ['sync'],
      deviceId: 'dev-1',
      refreshToken: 'refresh-token',
      accessToken: 'access-token',
      accessTokenExpiresAt: '2099-01-01T00:00:00Z',
      epoch: 3,
      cursor: 42,
    })
    const active = (await readBinding())!
    await migrateActiveBinding(active, { instanceId: 'srv_1', keyId: 'key-1', serverUrl: 'https://new.example/path/' })
    const migrated = await readBinding()
    expect(migrated?.serverUrl).toBe('https://new.example/path')
    expect(migrated?.origin).toBe('https://new.example')
    expect(migrated?.deviceId).toBe('dev-1')
    expect(migrated?.refreshToken).toBe('refresh-token')
    expect(migrated?.accessToken).toBe('access-token')
    expect(migrated?.epoch).toBe(3)
    expect(migrated?.cursor).toBe(42)
  })

  it('persists a candidate session without touching the active binding', async () => {
    await persistActiveBinding({
      serverUrl: 'https://sync.example.com',
      instanceId: 'srv_1',
      keyId: 'key-1',
      keyPrefix: 'srk_sync_ab',
      role: 'sync',
      capabilities: ['sync'],
      deviceId: 'dev-1',
      refreshToken: 'refresh',
      accessToken: 'access',
      accessTokenExpiresAt: '2099-01-01T00:00:00Z',
      epoch: 1,
      cursor: 0,
    })
    const candidate: CandidateConnection = {
      serverUrl: 'https://other.example',
      instanceId: 'srv_2',
      keyId: 'key-9',
      keyPrefix: 'srk_sync_cd',
      role: 'sync',
      capabilities: ['sync'],
      bindSessionId: 'bind-2',
      bindToken: 'bind-token-2',
      expiresAt: '2099-01-01T00:00:00Z',
      cloud: { hasData: false, cloudSeq: 0, syncEpoch: 1 },
    }
    await saveCandidateSession(candidate)
    const session = await readBindSession()
    expect(session?.bindSessionId).toBe('bind-2')
    expect(session?.step).toBe('started')
    expect(JSON.stringify(session)).not.toMatch(/srk_(admin|sync)_[A-Za-z0-9_-]{43}/)
    const active = await readBinding()
    expect(active?.instanceId).toBe('srv_1')
    expect(active?.serverUrl).toBe('https://sync.example.com')
  })

  it('detects unexpected instance changes that must suspend uploads', () => {
    const binding = { instanceId: 'srv_1' }
    expect(isInstanceMismatch(binding as never, 'srv_1')).toBe(false)
    expect(isInstanceMismatch(binding as never, 'srv_2')).toBe(true)
  })

  it('stops before any network call when permission is denied', async () => {
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(async () => false),
        request: vi.fn(async () => false),
      },
      runtime: { sendMessage: vi.fn(async () => undefined) },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(startConnection({ serverUrl: 'https://sync.example.com', srkey: 'srk_sync_x' })).rejects.toThrow('未授予')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requests a Chrome host-permission pattern for a bare server origin', async () => {
    const request = vi.fn(async () => true)
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn(async () => false),
        request,
      },
    })

    await expect(ensureOriginPermission('http://localhost:8787')).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith({ origins: ['http://localhost:8787/*'] })
  })

  it('disconnecting clears the binding and outbox', async () => {
    grantPermission()
    await persistActiveBinding({
      serverUrl: 'https://sync.example.com',
      instanceId: 'srv_1',
      keyId: 'key-1',
      keyPrefix: 'srk_sync_ab',
      role: 'sync',
      capabilities: ['sync'],
      deviceId: 'dev-1',
      refreshToken: 'refresh',
      accessToken: 'access',
      accessTokenExpiresAt: '2099-01-01T00:00:00Z',
      epoch: 1,
      cursor: 0,
    })
    await disconnectBinding()
    expect(await readBinding()).toBeUndefined()
    void writeBinding
  })
})
