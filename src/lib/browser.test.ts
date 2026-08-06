import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSettingsPage } from './browser'

describe('openSettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the Chrome extension options page', () => {
    const openOptionsPage = vi.fn()
    vi.stubGlobal('chrome', { runtime: { openOptionsPage } })

    openSettingsPage()

    expect(openOptionsPage).toHaveBeenCalledOnce()
  })

  it('does not throw when Chrome is unavailable', () => {
    vi.stubGlobal('chrome', undefined)

    expect(() => openSettingsPage()).not.toThrow()
  })
})
