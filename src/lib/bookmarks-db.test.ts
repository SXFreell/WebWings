import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createBookmark,
  createFolder,
  deleteNodeTree,
  exportBookmarks,
  getAllNodes,
  replaceAllNodes,
  validateImport,
} from './bookmarks-db'
import type { ExportPayload, FolderNode } from '../types'

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

  it('exports data and replaces the current database', async () => {
    await createBookmark({ title: 'OpenAI', url: 'https://openai.com', parentId: null })
    const payload = await exportBookmarks()
    expect(payload.format).toBe('webwings-bookmarks')
    expect(payload.nodes).toHaveLength(1)

    await replaceAllNodes([])
    expect(await getAllNodes()).toHaveLength(0)
    await replaceAllNodes(validateImport(payload))
    expect((await getAllNodes())[0]?.title).toBe('OpenAI')
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
})
