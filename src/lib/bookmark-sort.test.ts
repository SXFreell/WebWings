import { describe, expect, it } from 'vitest'
import type { BookmarkNode } from '../types'
import { normalizeSortMode, readSortMode, sortBookmarks, writeSortMode } from './bookmark-sort'

const bookmark = (values: Pick<BookmarkNode, 'id' | 'title' | 'order' | 'createdAt'>): BookmarkNode => ({
  ...values,
  type: 'bookmark',
  parentId: null,
  url: `https://${values.id}.example`,
  updatedAt: values.createdAt,
})

const items: BookmarkNode[] = [
  bookmark({ id: 'beta', title: 'Beta', order: 3, createdAt: '2025-02-01T00:00:00.000Z' }),
  bookmark({ id: 'alpha-new', title: 'Alpha', order: 7, createdAt: '2025-03-01T00:00:00.000Z' }),
  bookmark({ id: 'alpha-old', title: 'Alpha', order: 1, createdAt: '2025-01-01T00:00:00.000Z' }),
]

describe('bookmark sorting', () => {
  it('uses descending default order without mutating the source', () => {
    const source = [...items]
    expect(sortBookmarks(source, 'default').map((item) => item.id)).toEqual(['alpha-new', 'beta', 'alpha-old'])
    expect(source).toEqual(items)
  })

  it('sorts time in both directions', () => {
    expect(sortBookmarks(items, 'timeAsc').map((item) => item.id)).toEqual(['alpha-old', 'beta', 'alpha-new'])
    expect(sortBookmarks(items, 'timeDesc').map((item) => item.id)).toEqual(['alpha-new', 'beta', 'alpha-old'])
  })

  it('sorts localized titles in both directions and falls back to default order', () => {
    expect(sortBookmarks(items, 'titleAsc').map((item) => item.id)).toEqual(['alpha-new', 'alpha-old', 'beta'])
    expect(sortBookmarks(items, 'titleDesc').map((item) => item.id)).toEqual(['beta', 'alpha-new', 'alpha-old'])
  })

  it('normalizes unknown persisted values to the default mode', () => {
    expect(normalizeSortMode('timeDesc')).toBe('timeDesc')
    expect(normalizeSortMode('unknown')).toBe('default')
    expect(normalizeSortMode(null)).toBe('default')
  })

  it('reads and writes the sorting preference through the provided storage', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }

    expect(readSortMode(storage)).toBe('default')
    writeSortMode(storage, 'titleDesc')
    expect(readSortMode(storage)).toBe('titleDesc')
  })
})
