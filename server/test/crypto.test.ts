import { describe, expect, it } from 'vitest'
import {
  constantTimeEqual,
  generateSrkey,
  hashSrkey,
  hashToken,
  keyPrefix,
  parseSrkey,
  randomToken,
} from '../src/crypto'

describe('srkey and token crypto', () => {
  it('generates role-prefixed high-entropy srkeys with safe display prefixes', () => {
    const admin = generateSrkey('admin')
    const sync = generateSrkey('sync')
    expect(admin.startsWith('srk_admin_')).toBe(true)
    expect(sync.startsWith('srk_sync_')).toBe(true)
    expect(admin.length).toBeGreaterThan(50)
    expect(keyPrefix(admin).length).toBe(16)
    expect(keyPrefix(sync)).not.toContain(sync.slice(16))
  })

  it('hashes srkeys with the pepper and never returns the raw value', () => {
    const raw = generateSrkey('sync')
    const digest = hashSrkey('pepper-1234567890', raw)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).not.toContain(raw)
    expect(hashSrkey('pepper-1234567890', raw)).toBe(digest)
    expect(hashSrkey('different-pepper', raw)).not.toBe(digest)
  })

  it('compares tokens in constant time and hashes opaque tokens', () => {
    const token = randomToken()
    expect(token.length).toBeGreaterThan(40)
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(constantTimeEqual(token, token)).toBe(true)
    expect(constantTimeEqual(token, `${token}x`)).toBe(false)
    expect(constantTimeEqual('a', 'b')).toBe(false)
  })

  it('parses only well-formed role-prefixed srkeys', () => {
    const admin = generateSrkey('admin')
    const parsed = parseSrkey(admin)
    expect(parsed.role).toBe('admin')
    expect(parsed.prefix).toBe(admin.slice(0, 16))
    expect(parsed.body).toHaveLength(43)
    expect(() => parseSrkey('not-a-key')).toThrow()
    expect(() => parseSrkey(`srk_member_${'a'.repeat(43)}`)).toThrow()
    expect(() => parseSrkey(`srk_sync_${'a'.repeat(42)}`)).toThrow()
  })
})
