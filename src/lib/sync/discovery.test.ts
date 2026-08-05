import { afterEach, describe, expect, it, vi } from 'vitest'
import { discover } from './discovery'

const validInfo = {
  service: 'webwings-sync',
  apiVersion: 1,
  instanceId: 'srv_1',
  serverTime: new Date().toISOString(),
  minClientVersion: '1.0.0',
  features: ['sync', 'realtime'],
}

const mockFetch = (response: unknown, ok = true, status = 200) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => response,
    }) as unknown as Response),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('service discovery', () => {
  it('accepts a compatible webwings service', async () => {
    mockFetch(validInfo)
    const result = await discover('https://sync.example.com')
    expect(result).toMatchObject({ ok: true, instanceId: 'srv_1', apiVersion: 1 })
  })

  it('rejects invalid service identity and unsupported protocol versions', async () => {
    mockFetch({ ...validInfo, service: 'other-service' })
    expect((await discover('https://sync.example.com')).ok).toBe(false)

    mockFetch({ ...validInfo, apiVersion: 99 })
    const result = await discover('https://sync.example.com')
    expect(result).toMatchObject({ ok: false, code: 'incompatible' })
  })

  it('rejects clients below the minimum version', async () => {
    mockFetch({ ...validInfo, minClientVersion: '99.0.0' })
    expect(await discover('https://sync.example.com')).toMatchObject({ ok: false, code: 'version_too_old' })
  })

  it('maps network and malformed responses to distinct failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed') }))
    expect(await discover('https://sync.example.com')).toMatchObject({ ok: false, code: 'network' })

    mockFetch({ service: 'nonsense' })
    expect(await discover('https://sync.example.com')).toMatchObject({ ok: false, code: 'invalid' })
  })
})
