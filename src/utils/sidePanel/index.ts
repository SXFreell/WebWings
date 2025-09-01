/* global chrome */

export const openSidePanel = async() => {
  if (!chrome?.sidePanel) {
    return
  }
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (currentTab?.id !== undefined) {
    await chrome.sidePanel.open({ tabId: currentTab.id })
    await chrome.sidePanel.setOptions({ tabId: currentTab.id, path: 'sidePanel/index.html', enabled: true })
  }
}
