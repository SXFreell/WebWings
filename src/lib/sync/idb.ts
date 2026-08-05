import { nextPosition, toPosition } from './positions'

export const DB_NAME = 'webwings'
export const DB_VERSION = 2

export const STORE = {
  nodes: 'nodes',
  outbox: 'outbox',
  meta: 'meta',
  binding: 'binding',
  bindSessions: 'bindSessions',
} as const

export const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'))
})

export const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已取消'))
})

interface LegacyNode {
  id: string
  type: 'folder' | 'bookmark'
  parentId: string | null
  title: string
  order: number
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

const migrateLegacyNodes = (store: IDBObjectStore): void => {
  const request = store.getAll() as IDBRequest<LegacyNode[]>
  request.onsuccess = () => {
    const nodes = request.result
    const needsMigration = nodes.some((node) => typeof node.positionKey !== 'string')
    if (!needsMigration) return
    const byParent = new Map<string | null, LegacyNode[]>()
    for (const node of nodes) {
      const list = byParent.get(node.parentId) ?? []
      list.push(node)
      byParent.set(node.parentId, list)
    }
    const positionOf = new Map<string, string>()
    for (const [parentId, siblings] of byParent) {
      const ordered = [...siblings].sort(
        (a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id),
      )
      ordered.forEach((node, index) => {
        positionOf.set(node.id, toPosition(1_000_000_000_000n * BigInt(index + 1)))
      })
      void parentId
    }
    for (const node of nodes) {
      store.put({
        ...node,
        positionKey: positionOf.get(node.id) ?? nextPosition([]),
        syncVersion: 1,
        deletedAt: null,
        deleteBatchId: null,
        recoveryReason: null,
      })
    }
  }
}

export const openDatabase = (): Promise<IDBDatabase> => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    const upgradeTransaction = request.transaction!
    if (!db.objectStoreNames.contains(STORE.nodes)) {
      const store = db.createObjectStore(STORE.nodes, { keyPath: 'id' })
      store.createIndex('parentId', 'parentId', { unique: false })
      store.createIndex('type', 'type', { unique: false })
      store.createIndex('deletedAt', 'deletedAt', { unique: false })
    } else if (!upgradeTransaction.objectStore(STORE.nodes).indexNames.contains('deletedAt')) {
      const store = upgradeTransaction.objectStore(STORE.nodes)
      if (!store.indexNames.contains('deletedAt')) store.createIndex('deletedAt', 'deletedAt', { unique: false })
      migrateLegacyNodes(store)
    }
    if (!db.objectStoreNames.contains(STORE.outbox)) {
      const store = db.createObjectStore(STORE.outbox, { keyPath: 'id' })
      store.createIndex('createdAt', 'createdAt', { unique: false })
      store.createIndex('status', 'status', { unique: false })
    }
    if (!db.objectStoreNames.contains(STORE.meta)) db.createObjectStore(STORE.meta, { keyPath: 'id' })
    if (!db.objectStoreNames.contains(STORE.binding)) db.createObjectStore(STORE.binding, { keyPath: 'id' })
    if (!db.objectStoreNames.contains(STORE.bindSessions)) {
      db.createObjectStore(STORE.bindSessions, { keyPath: 'id' })
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'))
})

export const withStore = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, transaction: IDBTransaction) => Promise<T>,
): Promise<T> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(storeName, mode)
    const result = await work(transaction.objectStore(storeName), transaction)
    await transactionDone(transaction)
    return result
  } finally {
    db.close()
  }
}

export const getAll = async <T>(storeName: string): Promise<T[]> => withStore(storeName, 'readonly', (store) => requestToPromise(store.getAll() as IDBRequest<T[]>))

export const put = async <T>(storeName: string, value: T): Promise<void> => withStore(storeName, 'readwrite', (store) => requestToPromise(store.put(value as IDBValidKey)))

export const get = async <T>(storeName: string, key: string): Promise<T | undefined> => withStore(storeName, 'readonly', async (store) => {
  const result = await requestToPromise(store.get(key) as IDBRequest<T | undefined>)
  return result
})

export const remove = async (storeName: string, key: string): Promise<void> => withStore(storeName, 'readwrite', (store) => requestToPromise(store.delete(key)))
