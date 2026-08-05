import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../src/rateLimit'

describe('bind rate limiter', () => {
  it('allows up to the configured maximum and then rejects', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 })
    expect(limiter.check('1.2.3.4')).toBe(true)
    expect(limiter.check('1.2.3.4')).toBe(true)
    expect(limiter.check('1.2.3.4')).toBe(true)
    expect(limiter.check('1.2.3.4')).toBe(false)
    expect(limiter.check('5.6.7.8')).toBe(true)
  })

  it('resets after the window elapses', () => {
    const limiter = createRateLimiter({ windowMs: 1, max: 1 })
    expect(limiter.check('ip')).toBe(true)
    expect(limiter.check('ip')).toBe(false)
  })

  it('supports explicit reset', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
    expect(limiter.check('ip')).toBe(true)
    limiter.reset('ip')
    expect(limiter.check('ip')).toBe(true)
  })
})
