import { atom } from 'jotai'
import { setSystemTheme } from '@/utils/theme'

// 主题
const _themeAtom = atom(localStorage.getItem('__theme') ?? 'light')
const themeAtom = atom(
  (get) => get(_themeAtom),
  (_, set, newStr: string) => {
    if (['dark', 'light', 'auto'].includes(newStr)) {
      set(_themeAtom, newStr)
      localStorage.setItem('__theme', newStr)
      document.body.setAttribute('arco-theme', newStr)
    }
    if (newStr === 'auto') {
      setSystemTheme()
    }
  },
)

// 侧边栏是否收起
const _siderCollapsedAtom = atom(localStorage.getItem('__siderCollapsed') === 'true' || false)
const siderCollapsedAtom = atom(
  (get) => get(_siderCollapsedAtom),
  (_, set, newBool: boolean) => {
    set(_siderCollapsedAtom, newBool)
    localStorage.setItem('__siderCollapsed', newBool.toString())
  },
)

export {
  themeAtom,
  siderCollapsedAtom,
}
