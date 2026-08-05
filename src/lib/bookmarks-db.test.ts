import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addNodesAtomically,
  createBookmark,
  createFolder,
  deleteNodeTree,
  exportBookmarks,
  getAllNodes,
  mergeImport,
  validateImport,
} from './bookmarks-db'
import type { BookmarkNode, ExportPayload, FolderNode } from '../types'

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

describe('bookmarks database', () => {
  beforeEach(deleteDatabase)

  it('creates nested folders and recursively deletes their bookmarks', async () => {
    const parent = await createFolder('工作', null)
    const child = await createFolder('项目 A', parent.id)
    await createBookmark({ title: '需求文档', url: 'https://example.com/spec', parentId: child.id })
    await createBookmark({ title: '未分类', url: 'https://example.com', parentId: null })

    expect(await getAllNodes()).toHaveLength(4)
    await deleteNodeTree(parent.id)

    const remaining = await getAllNodes()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.title).toBe('未分类')
  })

  it('exports all data in the v1 WebWings format', async () => {
    await createBookmark({ title: 'OpenAI', url: 'https://openai.com', parentId: null })
    const payload = await exportBookmarks()
    expect(payload.format).toBe('webwings-bookmarks')
    expect(payload.version).toBe(1)
    expect(payload.nodes).toHaveLength(1)
  })

  it('rejects cyclic folders and unsafe bookmark protocols', () => {
    const timestamp = new Date().toISOString()
    const folderA: FolderNode = { id: 'a', type: 'folder', parentId: 'b', title: 'A', order: 0, createdAt: timestamp, updatedAt: timestamp }
    const folderB: FolderNode = { id: 'b', type: 'folder', parentId: 'a', title: 'B', order: 0, createdAt: timestamp, updatedAt: timestamp }
    const cyclic: ExportPayload = { format: 'webwings-bookmarks', version: 1, exportedAt: timestamp, nodes: [folderA, folderB] }
    expect(() => validateImport(cyclic)).toThrow('循环嵌套')

    const unsafe = {
      format: 'webwings-bookmarks',
      version: 1,
      exportedAt: timestamp,
      nodes: [{ id: 'x', type: 'bookmark', parentId: null, title: 'unsafe', url: 'javascript:alert(1)', order: 0, createdAt: timestamp, updatedAt: timestamp }],
    }
    expect(() => validateImport(unsafe)).toThrow('链接格式无效')
  })

  it('merges a valid v1 file into a target folder with newly mapped ids', async () => {
    const target = await createFolder('目标目录', null)
    const existing = await createBookmark({ title: '已有收藏', url: 'https://existing.example', parentId: target.id })
    const timestamp = '2025-01-02T03:04:05.000Z'
    const payload: ExportPayload = {
      format: 'webwings-bookmarks',
      version: 1,
      exportedAt: timestamp,
      nodes: [
        { id: 'old-folder', type: 'folder', parentId: null, title: '导入目录', order: 0, createdAt: timestamp, updatedAt: timestamp },
        { id: 'old-bookmark', type: 'bookmark', parentId: 'old-folder', title: '导入收藏', url: 'https://imported.example', order: 0, createdAt: timestamp, updatedAt: timestamp },
      ],
    }
    const generatedIds = ['new-folder', 'new-bookmark']

    const imported = await mergeImport(payload, target.id, () => generatedIds.shift()!)

    expect(imported.map((node) => node.id)).toEqual(['new-folder', 'new-bookmark'])
    expect(imported[0]?.parentId).toBe(target.id)
    expect(imported[1]?.parentId).toBe('new-folder')
    const stored = await getAllNodes()
    expect(stored).toHaveLength(4)
    expect(stored.find((node) => node.id === existing.id)?.title).toBe('已有收藏')
    expect(stored.find((node) => node.id === 'new-bookmark')?.createdAt).toBe(timestamp)
  })

  it('imports the same file twice as independent trees', async () => {
    const timestamp = '2025-01-02T03:04:05.000Z'
    const payload: ExportPayload = {
      format: 'webwings-bookmarks',
      version: 1,
      exportedAt: timestamp,
      nodes: [{ id: 'old', type: 'bookmark', parentId: null, title: '重复收藏', url: 'https://repeat.example', order: 0, createdAt: timestamp, updatedAt: timestamp }],
    }

    await mergeImport(payload, null, () => 'first-import')
    await mergeImport(payload, null, () => 'second-import')

    const stored = await getAllNodes()
    expect(stored.map((node) => node.id).sort()).toEqual(['first-import', 'second-import'])
  })

  it('does not write anything when the file or target folder is invalid', async () => {
    const existing = await createBookmark({ title: '保留', url: 'https://keep.example', parentId: null })
    const invalidPayload = {
      format: 'webwings-bookmarks',
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: [{ id: 'bad', type: 'bookmark', parentId: 'missing', title: '无效', url: 'https://bad.example', order: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    }

    await expect(mergeImport(invalidPayload, null, () => 'new')).rejects.toThrow('上级目录无效')
    await expect(mergeImport({ ...invalidPayload, nodes: [] }, 'missing', () => 'new')).rejects.toThrow('导入目标目录不存在')
    expect(await getAllNodes()).toEqual([existing])
  })

  it('rolls back every add when an IndexedDB batch contains a duplicate id', async () => {
    const timestamp = new Date().toISOString()
    const duplicate: BookmarkNode = { id: 'duplicate', type: 'bookmark', parentId: null, title: '重复', url: 'https://duplicate.example', order: 0, createdAt: timestamp, updatedAt: timestamp }

    await expect(addNodesAtomically([duplicate, { ...duplicate, title: '第二条' }])).rejects.toBeTruthy()

    expect(await getAllNodes()).toEqual([])
  })
})
