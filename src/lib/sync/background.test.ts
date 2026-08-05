// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readBinding, readSyncStatus, writeBinding } from './local-ops'

const nowIso = '2026-08-05T00:00:00.000Z'

interface ListenerMap {
  installed?: () => void
  startup?: () => void
  alarm?: (alarm: { name: string }) => void
  message?: (message: { type?: string }, sender: unknown, sendResponse: (response?: unknown) => void) => boolean | undefined
}

let listeners: ListenerMap = {}

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

describe('extension service worker wiring', () => {
  beforeEach(deleteDatabase)
  afterEach(() => {
    vi.unstubAllGlobals()
    listeners = {}
  })

  const importBackground = async () => {
    vi.resetModules()
    listeners = {}
    vi.stubGlobal('chrome', {
      runtime: {
        onInstalled: { addListener: (fn: () => void) => { listeners.installed = fn } },
        onStartup: { addListener: (fn: () => void) => { listeners.startup = fn } },
        onMessage: { addListener: (fn: ListenerMap['message']) => { listeners.message = fn } },
        sendMessage: vi.fn(async () => undefined),
      },
      alarms: {
        create: vi.fn(async () => undefined),
        onAlarm: { addListener: (fn: (alarm: { name: string }) => void) => { listeners.alarm = fn } },
      },
      permissions: { contains: vi.fn(async () => true) },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/info')) {
        return { ok: true, status: 200, json: async () => ({ service: 'webwings-sync', apiVersion: 1, instanceId: 'srv_1', serverTime: nowIso, minClientVersion: '1.0.0', features: [] }) }
      }
      if (url.includes('/sync/pull')) {
        return { ok: true, status: 200, json: async () => ({ v: 1, status: 'ok', epoch: 1, currentSeq: 0, events: [] }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch)
    await import('../../background')
  }

  it('registers the retry alarm and runs startup reconstruction from the binding', async () => {
    await importBackground()
    const alarms = vi.mocked(chrome.alarms.create)
    listeners.installed?.()
    expect(alarms).toHaveBeenCalledWith('webwings-sync-retry', { periodInMinutes: 1 })

    await writeBinding({
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
    })
    listeners.startup?.()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await readSyncStatus())?.state).toBe('ok')
  })

  it('reconstructs on popup trigger messages and answers with a status snapshot', async () => {
    await importBackground()
    await writeBinding({
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
    })

    const triggerResponse = vi.fn()
    const keepOpen = listeners.message?.({ type: 'webwings-sync-trigger' }, {}, triggerResponse)
    expect(keepOpen).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(triggerResponse).toHaveBeenCalledWith({ ok: true })

    const statusResponse = vi.fn()
    listeners.message?.({ type: 'webwings-sync-status' }, {}, statusResponse)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(statusResponse).toHaveBeenCalledWith({ status: expect.objectContaining({ state: 'ok' }) })
  })

  it('keeps an alarm retry cycle without a binding harmless', async () => {
    await importBackground()
    listeners.alarm?.({ name: 'webwings-sync-retry' })
    listeners.alarm?.({ name: 'other-alarm' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await readBinding()).toBeUndefined()
  })
})
