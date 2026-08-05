import type { BindingRecord } from './local-ops'
import { triggerSync } from './engine'

interface SyncHint {
  type: 'sync_hint'
  epoch: number
  seq: number
}

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectAttempts = 0
let activeUrl: string | null = null
let heartbeatInterval = 30_000

const wsUrlOf = (serverUrl: string, token: string): string => {
  const base = new URL(serverUrl)
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${base.host}${base.pathname.replace(/\/$/, '')}/v1/realtime?token=${encodeURIComponent(token)}`
}

const clearTimers = () => {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

const scheduleReconnect = () => {
  if (reconnectTimer !== null || !activeUrl) return
  const delay = Math.min(60_000, 5_000 * 2 ** reconnectAttempts)
  reconnectAttempts += 1
  reconnectTimer = globalThis.setTimeout(() => {
    reconnectTimer = null
    if (activeUrl) void connectRealtimeTo(activeUrl, heartbeatInterval)
  }, delay)
}

const connectRealtimeTo = async (url: string, heartbeatMs: number): Promise<void> => {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const ws = new WebSocket(url)
  socket = ws
  ws.onopen = () => {
    reconnectAttempts = 0
    heartbeatTimer = globalThis.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    }, heartbeatMs)
  }
  ws.onmessage = (event) => {
    try {
      const hint = JSON.parse(String(event.data)) as SyncHint
      if (hint.type === 'sync_hint') void triggerSync('realtime')
    } catch {
      // Notifications are hints only; never treat payload as data.
    }
  }
  ws.onclose = (event) => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (socket === ws) socket = null
    // 4401: Key or device revoked — do not reconnect.
    // 1000: intentional close (disconnect or token refresh).
    if (event.code !== 4401 && event.code !== 1000 && activeUrl) scheduleReconnect()
  }
  ws.onerror = () => {
    ws.close()
  }
}

/**
 * Keeps a live hint channel for the active binding. Hints only say
 * "something changed"; the authoritative data still arrives via HTTP pull.
 */
export const connectRealtime = async (
  binding: BindingRecord,
  accessToken: string,
  heartbeatMs = 30_000,
): Promise<void> => {
  const url = wsUrlOf(binding.serverUrl, accessToken)
  if (url === activeUrl && socket?.readyState === WebSocket.OPEN) return
  activeUrl = url
  heartbeatInterval = heartbeatMs
  reconnectAttempts = 0
  closeRealtime()
  await connectRealtimeTo(url, heartbeatMs)
}

export const closeRealtime = (): void => {
  activeUrl = null
  clearTimers()
  if (socket) {
    socket.onclose = null
    socket.onmessage = null
    socket.onerror = null
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, 'closed')
    socket = null
  }
}
