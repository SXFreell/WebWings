// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeBinding, type BindingRecord } from '@/lib/sync/local-ops'
import { AdminKeysView } from './AdminKeysView'

const nowIso = '2026-08-05T00:00:00.000Z'

const binding = (role: 'admin' | 'sync'): BindingRecord => ({
  id: 'active',
  serverUrl: 'https://sync.example.com',
  origin: 'https://sync.example.com',
  instanceId: 'srv_1',
  keyId: 'key-1',
  keyPrefix: role === 'admin' ? 'srk_admin_ab' : 'srk_sync_ab',
  role,
  capabilities: role === 'admin' ? ['sync', 'keys:manage'] : ['sync'],
  deviceId: 'dev-1',
  refreshToken: 'refresh-1',
  accessToken: 'access-1',
  accessTokenExpiresAt: '2099-01-01T00:00:00Z',
  epoch: 1,
  cursor: 0,
  lastSyncAt: null,
})

const summary = (overrides: Partial<Record<string, unknown>> = {}) => ({
  keyId: 'key-2',
  keyPrefix: 'srk_sync_cd',
  role: 'sync',
  status: 'active',
  label: '工作电脑',
  deviceCount: 1,
  nodeCount: 3,
  createdAt: nowIso,
  lastUsedAt: nowIso,
  purgeAt: null,
  ...overrides,
})

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

const stubAdminServer = (options: { list?: unknown[]; deleteFails?: boolean } = {}) => {
  const calls: string[] = []
  let list = options.list ?? [summary()]
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    if (url.includes('/v1/admin/keys') && method === 'GET') {
      return { ok: true, status: 200, json: async () => list }
    }
    if (url.includes('/rotate')) {
      return { ok: true, status: 200, json: async () => ({ keyId: 'key-2', keyPrefix: 'srk_sync_gh', srkey: 'srk_sync_rotated0123456789abcdef0123456789abcdef' }) }
    }
    if (url.includes('/restore')) {
      return { ok: true, status: 200, json: async () => ({ keyId: 'key-2', keyPrefix: 'srk_sync_ij', srkey: 'srk_sync_restored0123456789abcdef0123456789abcdef' }) }
    }
    if (url.includes('/delete')) {
      if (options.deleteFails) {
        return { ok: false, status: 409, json: async () => ({ error: { code: 'only_admin', message: 'cannot delete the only administrator key' } }) }
      }
      list = [summary({ status: 'pending_delete', purgeAt: '2099-01-01T00:00:00Z' })]
      return { ok: true, status: 200, json: async () => ({ v: 1, status: 'ok' }) }
    }
    if (url.includes('/v1/admin/keys') && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ keyId: 'key-new', keyPrefix: 'srk_sync_ef', srkey: 'srk_sync_newsecret0123456789abcdef0123456789abcdef', label: '新建' }) }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as unknown as typeof fetch)
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => undefined) } })
  return calls
}

describe('AdminKeysView', () => {
  beforeEach(deleteDatabase)
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders only management metadata and action buttons for administrator bindings', async () => {
    stubAdminServer()
    await writeBinding(binding('admin'))
    render(<AdminKeysView />)
    await waitFor(() => expect(screen.getByText('Key 管理')).toBeTruthy())
    expect(screen.getByText('srk_sync_cd')).toBeTruthy()
    expect(screen.getByText(/1 台设备 · 3 条数据/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /轮换/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /删除/ })).toBeTruthy()
    expect(screen.queryByText(/https?:\/\//)).toBeNull()
    expect(screen.queryByText(/工作电脑收藏/)).toBeNull()
  })

  it('never renders management actions for a normal sync Key', async () => {
    stubAdminServer()
    await writeBinding(binding('sync'))
    render(<AdminKeysView />)
    expect(screen.queryByText('Key 管理')).toBeNull()
    expect(screen.queryByRole('button', { name: /新建 Key/ })).toBeNull()
  })

  it('reveals a new Key secret exactly once with copy and download affordances', async () => {
    const user = userEvent.setup()
    stubAdminServer()
    await writeBinding(binding('admin'))
    render(<AdminKeysView />)
    await waitFor(() => expect(screen.getByRole('button', { name: /新建 Key/ })).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /新建 Key/ }))
    await waitFor(() => expect(screen.getByText(/srk_sync_newsecret/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /复制/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /下载/ })).toBeTruthy()
    expect(screen.getByText(/仅显示这一次/)).toBeTruthy()
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain('srk_sync_newsecret')
  })

  it('confirms deletion and shows the pending-delete state with purge date', async () => {
    const user = userEvent.setup()
    stubAdminServer()
    await writeBinding(binding('admin'))
    render(<AdminKeysView />)
    await waitFor(() => expect(screen.getByRole('button', { name: /删除/ })).toBeTruthy())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /删除/ }))
    await waitFor(() => expect(screen.getByText('待删除')).toBeTruthy())
    expect(screen.getByText(/永久删除/)).toBeTruthy()
  })

  it('surfaces server protection when deleting the only administrator', async () => {
    stubAdminServer({ list: [summary({ role: 'admin', keyId: 'key-admin' })], deleteFails: true })
    await writeBinding(binding('admin'))
    render(<AdminKeysView />)
    await screen.findByText('srk_sync_cd')
    await waitFor(() => expect(screen.queryByRole('button', { name: /删除/ })).toBeNull())
  })
})
