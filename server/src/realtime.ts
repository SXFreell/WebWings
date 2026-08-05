import type { WebSocket } from 'ws'

export interface RealtimeHint {
  type: 'sync_hint'
  epoch: number
  seq: number
}

/**
 * Namespace-isolated realtime hints. Notifications only carry (epoch, seq);
 * clients always pull authoritative events over HTTP.
 */
export class RealtimeHub {
  private byNamespace = new Map<string, Set<WebSocket>>()
  private byKey = new Map<string, Set<WebSocket>>()

  register(namespaceId: string, keyId: string, socket: WebSocket): () => void {
    const namespaceSockets = this.byNamespace.get(namespaceId) ?? new Set<WebSocket>()
    namespaceSockets.add(socket)
    this.byNamespace.set(namespaceId, namespaceSockets)
    const keySockets = this.byKey.get(keyId) ?? new Set<WebSocket>()
    keySockets.add(socket)
    this.byKey.set(keyId, keySockets)
    return () => {
      namespaceSockets.delete(socket)
      keySockets.delete(socket)
      if (namespaceSockets.size === 0) this.byNamespace.delete(namespaceId)
      if (keySockets.size === 0) this.byKey.delete(keyId)
    }
  }

  notify(namespaceId: string, epoch: number, seq: number): void {
    const hint: RealtimeHint = { type: 'sync_hint', epoch, seq }
    const payload = JSON.stringify(hint)
    for (const socket of this.byNamespace.get(namespaceId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(payload)
    }
  }

  revokeKey(keyId: string): void {
    for (const socket of this.byKey.get(keyId) ?? []) {
      try {
        socket.close(4403, 'key_revoked')
      } catch {
        // socket already closing
      }
    }
  }

  connectionCount(): number {
    let count = 0
    for (const sockets of this.byNamespace.values()) count += sockets.size
    return count
  }
}
