import { describe, expect, it } from 'vitest'
import { redact } from '../src/logger'

describe('logger redaction', () => {
  it('redacts srkeys, tokens and authorization headers at any depth', () => {
    const input = {
      srkey: 'srk_sync_secret',
      Authorization: 'Bearer abc',
      nested: { accessToken: 'token-1', refreshToken: 'token-2' },
      body: { bindToken: 'bind-1' },
      instanceId: 'srv_1',
      opId: 'op-1',
      backup: { cloud: 'content' },
    }
    const output = redact(input) as Record<string, unknown>
    expect(output.srkey).toBe('[REDACTED]')
    expect(output.Authorization).toBe('[REDACTED]')
    expect((output.nested as Record<string, unknown>).accessToken).toBe('[REDACTED]')
    expect((output.body as Record<string, unknown>).bindToken).toBe('[REDACTED]')
    expect(output.instanceId).toBe('srv_1')
    expect(output.opId).toBe('op-1')
    expect(output.backup).toBe('[REDACTED]')
  })

  it('handles arrays and circular references', () => {
    const circular: Record<string, unknown> = { items: [{ token: 'x' }] }
    circular.self = circular
    const output = redact(circular) as Record<string, unknown>
    expect((output.items as Array<Record<string, unknown>>)[0].token).toBe('[REDACTED]')
    expect(output.self).toBe('[CIRCULAR]')
  })
})
