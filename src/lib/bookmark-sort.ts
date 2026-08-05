import type { BookmarkNode } from '../types'

export type BookmarkSortMode = 'default' | 'timeAsc' | 'timeDesc' | 'titleAsc' | 'titleDesc'

export const SORT_STORAGE_KEY = 'webwings:bookmark-sort'
const SORT_MODES: BookmarkSortMode[] = ['default', 'timeAsc', 'timeDesc', 'titleAsc', 'titleDesc']
const titleCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export const normalizeSortMode = (value: unknown): BookmarkSortMode => (
  SORT_MODES.includes(value as BookmarkSortMode) ? value as BookmarkSortMode : 'default'
)

type SortStorage = Pick<Storage, 'getItem' | 'setItem'>

export const readSortMode = (storage: Pick<SortStorage, 'getItem'>): BookmarkSortMode => {
  try {
    return normalizeSortMode(storage.getItem(SORT_STORAGE_KEY))
  } catch {
    return 'default'
  }
}

export const writeSortMode = (storage: Pick<SortStorage, 'setItem'>, mode: BookmarkSortMode): void => {
  try {
    storage.setItem(SORT_STORAGE_KEY, mode)
  } catch {
    // Storage may be unavailable in a restricted extension context.
  }
}

const defaultCompare = (a: BookmarkNode, b: BookmarkNode) => b.order - a.order || a.id.localeCompare(b.id)

export const sortBookmarks = (bookmarks: BookmarkNode[], mode: BookmarkSortMode): BookmarkNode[] => {
  const compare = (a: BookmarkNode, b: BookmarkNode) => {
    if (mode === 'timeAsc' || mode === 'timeDesc') {
      const difference = Date.parse(a.createdAt) - Date.parse(b.createdAt)
      if (difference) return mode === 'timeAsc' ? difference : -difference
    }
    if (mode === 'titleAsc' || mode === 'titleDesc') {
      const difference = titleCollator.compare(a.title, b.title)
      if (difference) return mode === 'titleAsc' ? difference : -difference
    }
    return defaultCompare(a, b)
  }
  return [...bookmarks].sort(compare)
}
