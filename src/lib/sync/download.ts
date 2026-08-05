/**
 * Downloads a generated backup archive and resolves only after the browser
 * reports the download as complete. Reconciliation stays disabled until this
 * succeeds. Falls back to an anchor download outside the extension context.
 */
export const downloadAndWait = async (blob: Blob, filename: string, timeoutMs = 60_000): Promise<void> => {
  if (typeof chrome !== 'undefined' && chrome.downloads) {
    const url = URL.createObjectURL(blob)
    try {
      const downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' })
      await waitForDownload(downloadId, timeoutMs)
      return
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

const waitForDownload = async (downloadId: number, timeoutMs: number): Promise<void> => {
  const startedAt = Date.now()
  for (;;) {
    const items = await chrome.downloads.search({ id: downloadId })
    const item = items[0]
    if (item?.state === 'complete') return
    if (item?.state === 'interrupted' || item?.error) {
      throw new Error('备份下载失败，请检查下载目录后重试')
    }
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待备份下载完成超时，请检查下载状态')
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}
