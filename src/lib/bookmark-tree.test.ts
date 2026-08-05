import { describe, expect, it } from 'vitest'
import type { FolderNode } from '@/types'
import { availableFolders, folderCascaderColumns, folderDisplayPath } from './bookmark-tree'

const folder = (id: string, title: string, parentId: string | null, order: number): FolderNode => ({
  id, title, parentId, order, type: 'folder',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
})

const folders = [
  folder('work', '工作', null, 2),
  folder('life', '生活', null, 1),
  folder('frontend', '前端', 'work', 1),
  folder('react', 'React', 'frontend', 1),
]

describe('folder cascader data', () => {
  it('builds one sorted column per expanded level', () => {
    expect(folderCascaderColumns(folders, ['work', 'frontend']).map((column) => column.map((item) => item.id)))
      .toEqual([['life', 'work'], ['frontend'], ['react']])
  })

  it('uses a literal full path and falls back to the root label for an invalid id', () => {
    expect(folderDisplayPath(folders, 'react', '根目录')).toBe('工作 / 前端 / React')
    expect(folderDisplayPath(folders, 'missing', '根目录')).toBe('根目录')
    expect(folderDisplayPath(folders, null, '未分类')).toBe('未分类')
  })

  it('removes excluded folders so their descendants cannot appear in columns', () => {
    const visible = availableFolders(folders, new Set(['work', 'frontend', 'react']))
    expect(folderCascaderColumns(visible, ['work']).flat().map((item) => item.id)).toEqual(['life'])
  })

  it('ignores orphaned and cyclic paths without looping', () => {
    const malformed = [
      ...folders,
      folder('orphan', '孤立', 'missing', 1),
      folder('cycle-a', '循环 A', 'cycle-b', 1),
      folder('cycle-b', '循环 B', 'cycle-a', 1),
    ]
    expect(folderDisplayPath(malformed, 'orphan', '根目录')).toBe('孤立')
    expect(folderDisplayPath(malformed, 'cycle-a', '根目录')).toMatch(/循环 A/)
  })
})
