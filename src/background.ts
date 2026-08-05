/**
 * Extension Service Worker (MV3 module). The full sync engine lives here;
 * this entry keeps the worker alive for the alarms that trigger recovery.
 * Task 10 replaces the placeholder with the complete sync loop.
 */
const RETRY_ALARM = 'webwings-sync-retry'

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RETRY_ALARM) return
  // Recovered by the sync engine registered in background sync (task 10).
})

export {}
