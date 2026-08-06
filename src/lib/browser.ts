export interface CurrentPage {
  title: string
  url: string
  favicon?: string
}

export const getCurrentPage = async (): Promise<CurrentPage> => {
  if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    if (!tab?.url) throw new Error('无法读取当前页面，请刷新页面后重试')
    if (!/^https?:\/\//i.test(tab.url)) throw new Error('当前页面不支持收藏')
    return {
      title: tab.title?.trim() || new URL(tab.url).hostname,
      url: tab.url,
      favicon: tab.favIconUrl,
    }
  }

  return {
    title: document.title || 'WebWings 示例页面',
    url: window.location.href,
  }
}

export const openBookmark = (url: string) => {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export const openSettingsPage = (): void => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
    void chrome.runtime.openOptionsPage()
  }
}
