type Listener = () => void

const listeners = new Set<Listener>()

/** Subscribe to local data changes (local writes, remote commits, snapshot installs). */
export const onLocalChange = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const emitLocalChange = (): void => {
  for (const listener of [...listeners]) listener()
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const result = chrome.runtime.sendMessage({ type: 'webwings:local-change' })
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch(() => undefined)
      }
    } catch {
      // no runtime listener (tests or worker without popup)
    }
  }
}
