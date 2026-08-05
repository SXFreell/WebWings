import { useCallback, useState } from 'react'
import { readSortMode, writeSortMode, type BookmarkSortMode } from '@/lib/bookmark-sort'

export const useBookmarkSort = () => {
  const [sortMode, setSortModeState] = useState<BookmarkSortMode>(() => readSortMode(window.localStorage))

  const setSortMode = useCallback((mode: BookmarkSortMode) => {
    setSortModeState(mode)
    writeSortMode(window.localStorage, mode)
  }, [])

  return [sortMode, setSortMode] as const
}
