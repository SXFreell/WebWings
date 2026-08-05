import { describe, expect, it } from 'vitest'
import { RealtimeHub } from '../src/realtime'

class FakeSocket {
  readyState = 1
  OPEN = 1
  sent: string[] = []
  closed: { code?: number; reason?: string } | null = null
  send(payload: string): void {
    this.sent.push(payload)
  }
  close(code?: number, reason?: string): void {
    this.readyState = 3
    this.closed = { code, reason }
  }
  on(): void {}
}

describe('realtime hub', () => {
  it('publishes hints only to the matching namespace', () => {
    const hub = new RealtimeHub()
    const a = new FakeSocket()
    const b = new FakeSocket()
    hub.register('ns-a', 'key-a', a as never)
    hub.register('ns-b', 'key-b', b as never)
    hub.notify('ns-a', 1, 42)
    expect(a.sent).toEqual([JSON.stringify({ type: 'sync_hint', epoch: 1, seq: 42 })])
    expect(b.sent).toEqual([])
  })

  it('stops delivering after unregister and closes sockets on key revocation', () => {
    const hub = new RealtimeHub()
    const a = new FakeSocket()
    const unregister = hub.register('ns-a', 'key-a', a as never)
    hub.revokeKey('key-a')
    expect(a.closed?.code).toBe(4403)
    unregister()
    hub.notify('ns-a', 1, 1)
    expect(a.sent).toEqual([])
  })
})
