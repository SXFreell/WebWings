import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadAndWait } from './download'

describe('downloadAndWait', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('resolves only after Chrome reports the download complete', async () => {
    vi.useFakeTimers()
    const search = vi.fn()
      .mockResolvedValueOnce([{ id: 1, state: 'in_progress' }])
      .mockResolvedValueOnce([{ id: 1, state: 'complete' }])
    vi.stubGlobal('chrome', {
      downloads: {
        download: vi.fn().mockResolvedValue(1),
        search,
      },
    })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:backup'), revokeObjectURL: vi.fn() })
    let resolved = false
    const pending = downloadAndWait(new Blob(['backup']), 'backup.zip').then(() => { resolved = true })

    await vi.advanceTimersByTimeAsync(0)
    expect(search).toHaveBeenCalledOnce()
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(400)
    await pending
    expect(resolved).toBe(true)
  })
})
