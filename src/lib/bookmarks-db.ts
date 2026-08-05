import type { BookmarkNode, ExportPayload, FavoriteNode, FolderNode } from '../types'
import { createFolderExport, createFullExport, remapImportedNodes } from './bookmark-transfer'

const DB_NAME = 'webwings'
const DB_VERSION = 1
const NODE_STORE = 'nodes'

const requestToPromise = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'))
})

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已取消'))
})

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(NODE_STORE)) {
      const store = db.createObjectStore(NODE_STORE, { keyPath: 'id' })
      store.createIndex('parentId', 'parentId', { unique: false })
      store.createIndex('type', 'type', { unique: false })
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'))
})

const makeId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const now = () => new Date().toISOString()

export const getAllNodes = async (): Promise<FavoriteNode[]> => {
  const db = await openDatabase()
  try {
    return await requestToPromise(db.transaction(NODE_STORE).objectStore(NODE_STORE).getAll())
  } finally {
    db.close()
  }
}

const nextOrder = (nodes: FavoriteNode[], parentId: string | null) => {
  const siblings = nodes.filter((node) => node.parentId === parentId)
  return siblings.length ? Math.max(...siblings.map((node) => node.order)) + 1 : 0
}

export const createFolder = async (title: string, parentId: string | null): Promise<FolderNode> => {
  const nodes = await getAllNodes()
  const timestamp = now()
  const folder: FolderNode = {
    id: makeId(),
    type: 'folder',
    parentId,
    title: title.trim(),
    order: nextOrder(nodes, parentId),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await putNode(folder)
  return folder
}

export const createBookmark = async (
  values: Pick<BookmarkNode, 'title' | 'url' | 'favicon'> & { parentId: string | null },
): Promise<BookmarkNode> => {
  const nodes = await getAllNodes()
  const timestamp = now()
  const bookmark: BookmarkNode = {
    id: makeId(),
    type: 'bookmark',
    parentId: values.parentId,
    title: values.title.trim(),
    url: values.url.trim(),
    favicon: values.favicon,
    order: nextOrder(nodes, values.parentId),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await putNode(bookmark)
  return bookmark
}

export const putNode = async (node: FavoriteNode): Promise<void> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(NODE_STORE, 'readwrite')
    transaction.objectStore(NODE_STORE).put({ ...node, updatedAt: now() })
    await transactionDone(transaction)
  } finally {
    db.close()
  }
}

export const deleteNodeTree = async (id: string): Promise<void> => {
  const nodes = await getAllNodes()
  const ids = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        changed = true
      }
    }
  }

  const db = await openDatabase()
  try {
    const transaction = db.transaction(NODE_STORE, 'readwrite')
    const store = transaction.objectStore(NODE_STORE)
    ids.forEach((nodeId) => store.delete(nodeId))
    await transactionDone(transaction)
  } finally {
    db.close()
  }
}

export const exportBookmarks = async (): Promise<ExportPayload> => createFullExport(await getAllNodes())

export const exportFolderBookmarks = async (folderId: string): Promise<ExportPayload> => (
  createFolderExport(await getAllNodes(), folderId)
)

const isValidIsoDate = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

export const validateImport = (input: unknown): FavoriteNode[] => {
  if (!input || typeof input !== 'object') throw new Error('JSON 文件内容无效')
  const payload = input as Partial<ExportPayload>
  if (payload.format !== 'webwings-bookmarks' || payload.version !== 1 || !Array.isArray(payload.nodes)) {
    throw new Error('不是有效的 WebWings 收藏夹文件')
  }

  const ids = new Set<string>()
  for (const raw of payload.nodes) {
    if (!raw || typeof raw !== 'object') throw new Error('收藏数据中存在无效项目')
    const node = raw as FavoriteNode
    if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw new Error('收藏项目 ID 无效或重复')
    if (node.type !== 'folder' && node.type !== 'bookmark') throw new Error('收藏项目类型无效')
    if (node.parentId !== null && typeof node.parentId !== 'string') throw new Error('目录关联无效')
    if (typeof node.title !== 'string' || !node.title.trim()) throw new Error('收藏项目名称不能为空')
    if (!Number.isFinite(node.order) || !isValidIsoDate(node.createdAt) || !isValidIsoDate(node.updatedAt)) {
      throw new Error('收藏项目元数据无效')
    }
    if (node.type === 'bookmark') {
      if (typeof node.url !== 'string') throw new Error('收藏链接无效')
      try {
        const url = new URL(node.url)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
      } catch { throw new Error(`链接格式无效：${node.title}`) }
    }
    ids.add(node.id)
  }

  const byId = new Map(payload.nodes.map((node) => [node.id, node]))
  for (const node of payload.nodes) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId)
      if (!parent || parent.type !== 'folder') throw new Error(`“${node.title}”的上级目录无效`)
    }
    const visited = new Set<string>([node.id])
    let parentId = node.parentId
    while (parentId) {
      if (visited.has(parentId)) throw new Error('目录结构中存在循环嵌套')
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  return payload.nodes
}

export const addNodesAtomically = async (nodes: FavoriteNode[]): Promise<void> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(NODE_STORE, 'readwrite')
    const store = transaction.objectStore(NODE_STORE)
    nodes.forEach((node) => store.add(node))
    await transactionDone(transaction)
  } finally {
    db.close()
  }
}

export const mergeImport = async (
  input: unknown,
  targetParentId: string | null,
  createId: () => string = makeId,
): Promise<FavoriteNode[]> => {
  const validated = validateImport(input)
  const existing = await getAllNodes()
  const imported = remapImportedNodes(validated, existing, targetParentId, createId)
  await addNodesAtomically(imported)
  return imported
}
