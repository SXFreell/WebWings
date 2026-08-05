import { describe, expect, it } from 'vitest'
import type { BookmarkNode, FavoriteNode, FolderNode } from '../types'
import { createFolderExport, createFullExport, remapImportedNodes } from './bookmark-transfer'

const timestamp = '2026-08-03T10:00:00.000Z'

const folder = (values: Pick<FolderNode, 'id' | 'parentId' | 'title' | 'order'>): FolderNode => ({
  ...values,
  type: 'folder',
  createdAt: timestamp,
  updatedAt: timestamp,
})

const bookmark = (values: Pick<BookmarkNode, 'id' | 'parentId' | 'title' | 'order' | 'url'>): BookmarkNode => ({
  ...values,
  type: 'bookmark',
  createdAt: timestamp,
  updatedAt: timestamp,
})

describe('bookmark export payloads', () => {
  it('creates a valid empty full export', () => {
    expect(createFullExport([], timestamp)).toEqual({
      format: 'webwings-bookmarks',
      version: 1,
      exportedAt: timestamp,
      nodes: [],
    })
  })

  it('exports folder contents as a self-contained forest without the source folder', () => {
    const nodes: FavoriteNode[] = [
      folder({ id: 'source', parentId: null, title: '工作', order: 0 }),
      bookmark({ id: 'direct', parentId: 'source', title: '直接收藏', order: 0, url: 'https://direct.example' }),
      folder({ id: 'child', parentId: 'source', title: '项目', order: 1 }),
      bookmark({ id: 'nested', parentId: 'child', title: '嵌套收藏', order: 0, url: 'https://nested.example' }),
      folder({ id: 'outside', parentId: null, title: '其他', order: 1 }),
      bookmark({ id: 'outside-bookmark', parentId: 'outside', title: '其他收藏', order: 0, url: 'https://outside.example' }),
    ]

    const payload = createFolderExport(nodes, 'source', timestamp)

    expect(payload.nodes).toEqual([
      { ...nodes[1], parentId: null },
      { ...nodes[2], parentId: null },
      nodes[3],
    ])
    expect(nodes[1]?.parentId).toBe('source')
  })

  it('rejects a folder export when the source is missing or is not a folder', () => {
    const nodes: FavoriteNode[] = [bookmark({ id: 'bookmark', parentId: null, title: '收藏', order: 0, url: 'https://example.com' })]
    expect(() => createFolderExport(nodes, 'missing', timestamp)).toThrow('导出目录不存在')
    expect(() => createFolderExport(nodes, 'bookmark', timestamp)).toThrow('导出目标不是目录')
  })
})

describe('bookmark import remapping', () => {
  it('replaces every id, reconnects internal parents, and attaches roots to the target', () => {
    const imported: FavoriteNode[] = [
      folder({ id: 'old-folder', parentId: null, title: '项目', order: 4 }),
      bookmark({ id: 'old-bookmark', parentId: 'old-folder', title: '文档', order: 2, url: 'https://example.com/doc' }),
      bookmark({ id: 'old-root', parentId: null, title: '入口', order: 8, url: 'https://example.com' }),
    ]
    const existing: FavoriteNode[] = [
      folder({ id: 'target', parentId: null, title: '目标', order: 0 }),
      bookmark({ id: 'existing-a', parentId: 'target', title: '已有 A', order: 3, url: 'https://a.example' }),
      bookmark({ id: 'existing-b', parentId: 'target', title: '已有 B', order: 7, url: 'https://b.example' }),
    ]
    const ids = ['new-folder', 'new-bookmark', 'new-root']

    const result = remapImportedNodes(imported, existing, 'target', () => ids.shift()!)

    expect(result).toEqual([
      { ...imported[0], id: 'new-folder', parentId: 'target', order: 8 },
      { ...imported[1], id: 'new-bookmark', parentId: 'new-folder' },
      { ...imported[2], id: 'new-root', parentId: 'target', order: 9 },
    ])
    expect(result.every((node) => !node.id.startsWith('old-'))).toBe(true)
  })

  it('attaches imported roots to the database root and preserves relative root order', () => {
    const imported: FavoriteNode[] = [
      bookmark({ id: 'second', parentId: null, title: '第二', order: 9, url: 'https://second.example' }),
      bookmark({ id: 'first', parentId: null, title: '第一', order: 2, url: 'https://first.example' }),
    ]
    const existing: FavoriteNode[] = [folder({ id: 'existing', parentId: null, title: '已有', order: 5 })]
    const ids = ['new-second', 'new-first']

    const result = remapImportedNodes(imported, existing, null, () => ids.shift()!)

    expect(result.find((node) => node.id === 'new-first')?.order).toBe(6)
    expect(result.find((node) => node.id === 'new-second')?.order).toBe(7)
    expect(result.every((node) => node.parentId === null)).toBe(true)
  })

  it('rejects a missing or non-folder import target', () => {
    const imported = [bookmark({ id: 'item', parentId: null, title: '收藏', order: 0, url: 'https://example.com' })]
    const existing = [bookmark({ id: 'not-folder', parentId: null, title: '已有', order: 0, url: 'https://existing.example' })]

    expect(() => remapImportedNodes(imported, existing, 'missing', () => 'new')).toThrow('导入目标目录不存在')
    expect(() => remapImportedNodes(imported, existing, 'not-folder', () => 'new')).toThrow('导入目标不是目录')
  })

  it('rejects generated ids that collide with existing or imported nodes', () => {
    const imported = [bookmark({ id: 'item', parentId: null, title: '收藏', order: 0, url: 'https://example.com' })]
    const existing = [folder({ id: 'existing', parentId: null, title: '已有', order: 0 })]
    expect(() => remapImportedNodes(imported, existing, null, () => 'existing')).toThrow('生成的收藏项目 ID 重复')
  })
})
