/**
 * Extension Service Worker (MV3 module). The engine reconstructs its state
 * exclusively from the persisted binding, cursor, epoch and outbox; nothing
 * else is kept in memory across worker terminations.
 */
import { triggerSync } from './lib/sync/engine'
import { connectRealtime, closeRealtime } from './lib/sync/realtime'
import { readBinding, readSyncStatus } from './lib/sync/local-ops'

const RETRY_ALARM = 'webwings-sync-retry'

/** Reconstructs from IndexedDB and starts one sync pass plus the hint channel. */
const startEngine = async (): Promise<void> => {
  const binding = await readBinding()
  if (!binding) {
    closeRealtime()
    return
  }
  await triggerSync('startup')
  const refreshed = (await readBinding()) ?? binding
  if (refreshed.accessToken) await connectRealtime(refreshed, refreshed.accessToken)
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 })
  void startEngine()
})

chrome.runtime.onStartup.addListener(() => {
  void startEngine()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RETRY_ALARM) return
  void triggerSync('alarm')
})

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === 'webwings-sync-trigger') {
    void startEngine().then(() => sendResponse?.({ ok: true }))
    return true
  }
  if (message?.type === 'webwings-sync-disconnect') {
    closeRealtime()
    sendResponse?.({ ok: true })
    return false
  }
  if (message?.type === 'webwings-sync-status') {
    void readSyncStatus().then((status) => sendResponse?.({ status }))
    return true
  }
  return false
})

self.addEventListener('online', () => {
  void startEngine()
})

export {}
