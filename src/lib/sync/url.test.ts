import { describe, expect, it } from 'vitest'
import { hostPermissionOf, isLoopbackHost, normalizeServerUrl, originOf } from './url'

describe('server url normalization', () => {
  it('normalizes https roots and preserves subpaths', () => {
    expect(normalizeServerUrl('https://sync.example.com/')).toBe('https://sync.example.com')
    expect(normalizeServerUrl('https://sync.example.com')).toBe('https://sync.example.com')
    expect(normalizeServerUrl('https://sync.example.com/webwings//')).toBe('https://sync.example.com/webwings')
  })

  it('rejects credentials, query strings and fragments', () => {
    expect(() => normalizeServerUrl('https://user:pass@sync.example.com')).toThrow('用户名或密码')
    expect(() => normalizeServerUrl('https://sync.example.com?token=1')).toThrow('查询参数')
    expect(() => normalizeServerUrl('https://sync.example.com/#frag')).toThrow('片段')
  })

  it('rejects non-loopback http but allows loopback development hosts', () => {
    expect(() => normalizeServerUrl('http://sync.example.com')).toThrow('HTTPS')
    expect(normalizeServerUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(normalizeServerUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787')
    expect(normalizeServerUrl('http://[::1]:8787')).toBe('http://[::1]:8787')
  })

  it('derives origin and exact host permission patterns', () => {
    expect(originOf('https://sync.example.com/webwings')).toBe('https://sync.example.com')
    expect(hostPermissionOf('https://sync.example.com/webwings')).toBe('https://sync.example.com/*')
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('example.com')).toBe(false)
  })
})
