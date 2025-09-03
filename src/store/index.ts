import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { setSystemTheme } from '@/utils/theme'
import type { StoreStructure, FavoriteConfig } from './structure'

// 主题
const _themeAtom = atom<StoreStructure['theme']>(localStorage.getItem('__theme') as StoreStructure['theme'] ?? 'light')
const themeAtom = atom<StoreStructure['theme'], [StoreStructure['theme']], void>(
  (get) => get(_themeAtom),
  (_, set, newStr) => {
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
const siderCollapsedAtom = atomWithStorage<StoreStructure['siderCollapsed']>(
  '__siderCollapsed',
  localStorage.getItem('__siderCollapsed') === 'true',
)

// 收藏夹配置
const favoriteConfigAtom = atomWithStorage<FavoriteConfig>(
  '__favorite',
  localStorage.getItem('__favorite')
    ? JSON.parse(localStorage.getItem('__favorite') as string)
    : {
      sort: 'custom',
      view: 'list',
    },
)

export {
  themeAtom,
  siderCollapsedAtom,
  favoriteConfigAtom,
}
