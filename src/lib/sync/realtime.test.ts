import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BindingRecord } from './local-ops'
import { readBinding, writeBinding } from './local-ops'
import { closeRealtime, connectRealtime } from './realtime'

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

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code = 1000) {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code })
  }
}

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

describe('realtime hint channel', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(async () => true) },
      runtime: { sendMessage: vi.fn(async () => undefined) },
    })
    FakeWebSocket.instances = []
  })
  afterEach(() => {
    closeRealtime()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const stubServer = () => {
    const pulls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/info')) {
        return { ok: true, status: 200, json: async () => ({ service: 'webwings-sync', apiVersion: 1, instanceId: 'srv_1', serverTime: nowIso, minClientVersion: '1.0.0', features: [] }) }
      }
      if (url.includes('/sync/pull')) {
        pulls.push(url)
        return { ok: true, status: 200, json: async () => ({ v: 1, status: 'ok', epoch: 1, currentSeq: 0, events: [] }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch)
    return pulls
  }

  it('connects with the token-scoped websocket URL and pulls on sync hints', async () => {
    const pulls = stubServer()
    await writeBinding(binding())
    await connectRealtime((await readBinding())!, 'access-1')
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe('wss://sync.example.com/v1/realtime?token=access-1')

    FakeWebSocket.instances[0].open()
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.OPEN)
    await new Promise((resolve) => setTimeout(resolve, 0))

    FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'sync_hint', epoch: 1, seq: 9 }) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pulls.length).toBeGreaterThan(0)
    expect(pulls[0]).toContain('/v1/sync/pull')
  })

  it('uses ws:// for loopback HTTP servers', async () => {
    await writeBinding(binding({ serverUrl: 'http://127.0.0.1:8787', origin: 'http://127.0.0.1:8787' }))
    await connectRealtime((await readBinding())!, 'access-1')
    expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:8787/v1/realtime?token=access-1')
  })

  it('does not reconnect after a 4401 revocation close', async () => {
    await writeBinding(binding())
    await connectRealtime((await readBinding())!, 'access-1')
    FakeWebSocket.instances[0].close(4401)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('sends heartbeat pings and ignores non-hint payloads', async () => {
    const pulls = stubServer()
    await writeBinding(binding())
    await connectRealtime((await readBinding())!, 'access-1', 30)
    FakeWebSocket.instances[0].open()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(FakeWebSocket.instances[0].sent).toContain(JSON.stringify({ type: 'ping' }))

    FakeWebSocket.instances[0].onmessage?.({ data: 'not json at all' })
    FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'something_else' }) })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pulls).toHaveLength(0)
  })
})
