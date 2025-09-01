import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
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
const siderCollapsedAtom = atomWithStorage('__siderCollapsed', localStorage.getItem('__siderCollapsed') === 'true')

export {
  themeAtom,
  siderCollapsedAtom,
}
