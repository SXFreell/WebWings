// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeSyncStatus, type SyncStatusRecord } from '@/lib/sync/local-ops'
import { SyncStatusBadge } from './SyncStatusBadge'

const status = (overrides: Partial<SyncStatusRecord> = {}): SyncStatusRecord => ({
  id: 'syncStatus',
  state: 'ok',
  message: null,
  lastAttemptAt: '2026-08-05T00:00:00.000Z',
  lastSuccessAt: '2026-08-05T00:00:00.000Z',
  nextRetryAt: null,
  attempts: 0,
  ...overrides,
})

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

describe('SyncStatusBadge', () => {
  beforeEach(deleteDatabase)
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('stays silent during normal successful synchronization', async () => {
    await writeSyncStatus(status())
    render(<SyncStatusBadge />)
    expect(screen.queryByText(/离线|同步|失效|暂停|受阻/)).toBeNull()
  })

  it('shows a subtle indicator while syncing', async () => {
    await writeSyncStatus(status({ state: 'syncing' }))
    render(<SyncStatusBadge />)
    expect(await screen.findByText('同步中')).toBeTruthy()
  })

  it('surfaces attention states without blocking the page', async () => {
    await writeSyncStatus(status({ state: 'offline', message: '无法连接' }))
    render(<SyncStatusBadge />)
    expect(await screen.findByText(/离线，自动重试中/)).toBeTruthy()
  })

  it('shows terminal authentication failures and instance changes', async () => {
    await writeSyncStatus(status({ state: 'auth_failed', message: 'revoked' }))
    render(<SyncStatusBadge />)
    expect(await screen.findByText(/登录失效，请重新连接/)).toBeTruthy()
    cleanup()

    await writeSyncStatus(status({ state: 'instance_changed' }))
    render(<SyncStatusBadge />)
    expect(await screen.findByText(/服务器实例已改变，同步已暂停/)).toBeTruthy()
  })
})
