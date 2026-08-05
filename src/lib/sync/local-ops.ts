import type {
  NodePatch,
  SnapshotPayload,
  SyncEvent,
  SyncNode,
  SyncNodeCreateInput,
  SyncOperation,
} from '@webwings/sync-protocol'
import type { FavoriteNode } from '../../types'
import { get, getAll, openDatabase, put, requestToPromise, STORE, transactionDone, withStore } from './idb'
import { emitLocalChange } from './notify'
import { nextPosition, normalizePosition } from './positions'

export interface LocalMeta {
  id: 'meta'
  localRevision: number
  cursor: number
  epoch: number
  lastSyncAt: string | null
}

export type SyncState =
  | 'idle'
  | 'syncing'
  | 'ok'
  | 'offline'
  | 'auth_failed'
  | 'permission_missing'
  | 'instance_changed'
  | 'stalled'

export interface SyncStatusRecord {
  id: 'syncStatus'
  state: SyncState
  message: string | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  nextRetryAt: string | null
  attempts: number
}

export interface BindingRecord {
  id: 'active'
  serverUrl: string
  origin: string
  instanceId: string
  keyId: string
  keyPrefix: string
  role: 'admin' | 'sync'
  capabilities: string[]
  deviceId: string
  refreshToken: string
  accessToken: string | null
  accessTokenExpiresAt: string | null
  epoch: number
  cursor: number
  lastSyncAt: string | null
}

export type BindStep = 'started' | 'backup_created' | 'backup_downloaded' | 'backup_proven' | 'completed' | 'cancelled'

/** Resumable first-bind session persisted across popup/worker restarts. */
export interface BindSessionRecord {
  id: 'active'
  bindSessionId: string
  serverUrl: string
  origin: string
  instanceId: string
  keyId: string
  keyPrefix: string
  role: 'admin' | 'sync'
  capabilities: string[]
  bindToken: string
  expiresAt: string
  cloud: { hasData: boolean; cloudSeq: number; syncEpoch: number }
  createdAt: string
  step: BindStep
  cloudNodes: import('@webwings/sync-protocol').SyncNode[]
  cloudDigest: string
  /** Frozen local nodes captured at backup time; sent with bind complete. */
  localNodes: import('@webwings/sync-protocol').SyncNode[]
  localRevision: number
  localDigest: string
  backupArchiveName: string | null
  downloadedAt: string | null
  strategy: 'initialize_cloud' | 'use_cloud' | 'use_local' | 'merge' | null
  operationId: string | null
  error: string | null
}

export interface OutboxEntry {
  id: string
  seq: number
  epoch: number
  deviceId: string
  createdAt: string
  status: 'pending' | 'in_flight'
  op: SyncOperation
}

export const defaultMeta = (): LocalMeta => ({ id: 'meta', localRevision: 0, cursor: 0, epoch: 1, lastSyncAt: null })

export const readMeta = (): Promise<LocalMeta | undefined> => get<LocalMeta>(STORE.meta, 'meta')
export const readBinding = (): Promise<BindingRecord | undefined> => get<BindingRecord>(STORE.binding, 'active')
export const readSyncStatus = (): Promise<SyncStatusRecord | undefined> => get<SyncStatusRecord>(STORE.meta, 'syncStatus')
export const readOutbox = async (): Promise<OutboxEntry[]> => (await getAll<OutboxEntry>(STORE.outbox)).sort((a, b) => a.seq - b.seq)
export const writeMeta = (meta: LocalMeta): Promise<void> => put(STORE.meta, meta)
export const writeBinding = (binding: BindingRecord): Promise<void> => put(STORE.binding, binding)
export const writeSyncStatus = (status: SyncStatusRecord): Promise<void> => put(STORE.meta, status)
export const clearBinding = (): Promise<void> => withStore(STORE.binding, 'readwrite', (store) => requestToPromise(store.delete('active')))
export const writeBindSession = (session: BindSessionRecord): Promise<void> => put(STORE.bindSessions, session)
export const readBindSession = (): Promise<BindSessionRecord | undefined> => get<BindSessionRecord>(STORE.bindSessions, 'active')
export const clearBindSession = (): Promise<void> => withStore(STORE.bindSessions, 'readwrite', (store) => requestToPromise(store.delete('active')))

const now = () => new Date().toISOString()
const makeId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

interface LocalContext {
  meta: LocalMeta
  binding: BindingRecord | null
}

const readContext = async (): Promise<LocalContext> => {
  const existing = await readMeta()
  const meta = existing ?? defaultMeta()
  const binding = (await readBinding()) ?? null
  return { meta, binding }
}

const ensureMetaRow = async (store: IDBObjectStore, transaction: IDBTransaction): Promise<LocalMeta> => {
  const existing = (await requestToPromise(store.get('meta'))) as LocalMeta | undefined
  if (existing) return existing
  const meta = defaultMeta()
  await requestToPromise(store.put(meta))
  void transaction
  return meta
}

const nextOrder = (siblings: FavoriteNode[]): number => (siblings.length ? Math.max(...siblings.map((node) => node.order)) + 1 : 0)

const toCreateInput = (node: FavoriteNode): SyncNodeCreateInput => ({
  id: node.id,
  type: node.type,
  parentId: node.parentId,
  title: node.title,
  ...(node.type === 'bookmark' ? { url: node.url, ...(node.favicon ? { favicon: node.favicon } : {}) } : {}),
  positionKey: node.positionKey,
  createdAt: node.createdAt,
  updatedAt: node.updatedAt,
})

const enqueue = async (store: IDBObjectStore, binding: BindingRecord | null, op: SyncOperation, seq: number): Promise<void> => {
  if (!binding) return
  const entry: OutboxEntry = {
    id: op.opId,
    seq,
    epoch: op.syncEpoch,
    deviceId: binding.deviceId,
    createdAt: now(),
    status: 'pending',
    op,
  }
  await requestToPromise(store.put(entry))
}

const siblingKeys = async (store: IDBObjectStore, parentId: string | null): Promise<string[]> => {
  const index = store.index('parentId')
  const rows = (await requestToPromise(index.getAll(parentId))) as FavoriteNode[]
  return rows.filter((row) => !row.deletedAt).map((row) => row.positionKey ?? '').filter(Boolean)
}

const bumpMeta = async (store: IDBObjectStore, meta: LocalMeta): Promise<LocalMeta> => {
  const next = { ...meta, localRevision: meta.localRevision + 1 }
  await requestToPromise(store.put(next))
  return next
}

export interface CreatedLocalNode {
  node: FavoriteNode
  meta: LocalMeta
}

interface NodeFields {
  id: string
  type: 'folder' | 'bookmark'
  parentId: string | null
  title: string
  order: number
  createdAt: string
  updatedAt: string
  positionKey: string
  url?: string
  favicon?: string
}

const buildNode = (fields: NodeFields): FavoriteNode => {
  const base = {
    id: fields.id,
    parentId: fields.parentId,
    title: fields.title,
    order: fields.order,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
    positionKey: fields.positionKey,
    syncVersion: 1,
    deletedAt: null,
    deleteBatchId: null,
    recoveryReason: null,
  }
  return fields.type === 'bookmark'
    ? { ...base, type: 'bookmark' as const, url: fields.url!, ...(fields.favicon ? { favicon: fields.favicon } : {}) }
    : { ...base, type: 'folder' as const }
}

export const localCreateNode = async (input: SyncNodeCreateInput): Promise<CreatedLocalNode> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([STORE.nodes, STORE.meta, STORE.outbox, STORE.binding], 'readwrite')
    const nodesStore = transaction.objectStore(STORE.nodes)
    const metaStore = transaction.objectStore(STORE.meta)
    const outboxStore = transaction.objectStore(STORE.outbox)
    const bindingStore = transaction.objectStore(STORE.binding)
    const meta = await ensureMetaRow(metaStore, transaction)
    const binding = ((await requestToPromise(bindingStore.get('active'))) ?? null) as BindingRecord | null
    const parentKey = input.parentId ?? ''
    const index = nodesStore.index('parentId')
    const siblings = ((await requestToPromise(index.getAll(parentKey))) as FavoriteNode[]).filter((node) => !node.deletedAt)
    const timestamp = now()
    const positionKey = input.positionKey
      ? normalizePosition(input.positionKey)
      : nextPosition(siblings.map((node) => node.positionKey ?? '').filter(Boolean))
    const node = buildNode({
      id: input.id,
      type: input.type,
      parentId: input.parentId,
      title: input.title.trim(),
      order: nextOrder(siblings),
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
      positionKey,
      url: input.type === 'bookmark' ? input.url : undefined,
      favicon: input.type === 'bookmark' ? input.favicon : undefined,
    })
    await requestToPromise(nodesStore.put(node))
    const op: SyncOperation = {
      v: 1,
      opId: makeId(),
      deviceId: binding?.deviceId ?? 'local',
      syncEpoch: binding?.epoch ?? meta.epoch,
      type: 'create_node',
      node: toCreateInput(node),
    }
    await enqueue(outboxStore, binding, op, meta.localRevision + 1)
    const updatedMeta = await bumpMeta(metaStore, meta)
    await transactionDone(transaction)
    emitLocalChange()
    return { node, meta: updatedMeta }
  } finally {
    db.close()
  }
}

export const localPatchNode = async (nodeId: string, patch: NodePatch, baseVersion: number): Promise<void> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([STORE.nodes, STORE.meta, STORE.outbox, STORE.binding], 'readwrite')
    const nodesStore = transaction.objectStore(STORE.nodes)
    const metaStore = transaction.objectStore(STORE.meta)
    const outboxStore = transaction.objectStore(STORE.outbox)
    const bindingStore = transaction.objectStore(STORE.binding)
    const meta = await ensureMetaRow(metaStore, transaction)
    const binding = ((await requestToPromise(bindingStore.get('active'))) ?? null) as BindingRecord | null
    const existing = (await requestToPromise(nodesStore.get(nodeId))) as FavoriteNode | undefined
    if (!existing || existing.deletedAt) throw new Error('节点不存在或已删除')
    const updated: FavoriteNode = {
      ...existing,
      title: patch.title?.trim() ?? existing.title,
      ...(patch.url !== undefined && existing.type === 'bookmark' ? { url: patch.url.trim() } : {}),
      ...(patch.favicon !== undefined ? { favicon: patch.favicon } : {}),
      updatedAt: now(),
      syncVersion: (existing.syncVersion ?? 1) + 1,
    }
    await requestToPromise(nodesStore.put(updated))
    const op: SyncOperation = {
      v: 1,
      opId: makeId(),
      deviceId: binding?.deviceId ?? 'local',
      syncEpoch: binding?.epoch ?? meta.epoch,
      type: 'patch_node',
      nodeId,
      baseVersion,
      patch: Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as NodePatch,
    }
    await enqueue(outboxStore, binding, op, meta.localRevision + 1)
    await bumpMeta(metaStore, meta)
    await transactionDone(transaction)
    emitLocalChange()
  } finally {
    db.close()
  }
}

export const localMoveNode = async (nodeId: string, newParentId: string | null): Promise<void> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([STORE.nodes, STORE.meta, STORE.outbox, STORE.binding], 'readwrite')
    const nodesStore = transaction.objectStore(STORE.nodes)
    const metaStore = transaction.objectStore(STORE.meta)
    const outboxStore = transaction.objectStore(STORE.outbox)
    const bindingStore = transaction.objectStore(STORE.binding)
    const meta = await ensureMetaRow(metaStore, transaction)
    const binding = ((await requestToPromise(bindingStore.get('active'))) ?? null) as BindingRecord | null
    const existing = (await requestToPromise(nodesStore.get(nodeId))) as FavoriteNode | undefined
    if (!existing || existing.deletedAt) throw new Error('节点不存在或已删除')
    const index = nodesStore.index('parentId')
    const siblings = ((await requestToPromise(index.getAll(newParentId ?? ''))) as FavoriteNode[]).filter((node) => !node.deletedAt)
    const positionKey = nextPosition(siblings.map((node) => node.positionKey ?? '').filter(Boolean))
    const updated: FavoriteNode = {
      ...existing,
      parentId: newParentId,
      positionKey,
      order: nextOrder(siblings),
      updatedAt: now(),
      syncVersion: (existing.syncVersion ?? 1) + 1,
    }
    await requestToPromise(nodesStore.put(updated))
    const op: SyncOperation = {
      v: 1,
      opId: makeId(),
      deviceId: binding?.deviceId ?? 'local',
      syncEpoch: binding?.epoch ?? meta.epoch,
      type: 'move_node',
      nodeId,
      newParentId,
    }
    await enqueue(outboxStore, binding, op, meta.localRevision + 1)
    await bumpMeta(metaStore, meta)
    await transactionDone(transaction)
    emitLocalChange()
  } finally {
    db.close()
  }
}

export const localDeleteTree = async (nodeId: string): Promise<string[]> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([STORE.nodes, STORE.meta, STORE.outbox, STORE.binding], 'readwrite')
    const nodesStore = transaction.objectStore(STORE.nodes)
    const metaStore = transaction.objectStore(STORE.meta)
    const outboxStore = transaction.objectStore(STORE.outbox)
    const bindingStore = transaction.objectStore(STORE.binding)
    const meta = await ensureMetaRow(metaStore, transaction)
    const binding = ((await requestToPromise(bindingStore.get('active'))) ?? null) as BindingRecord | null
    const all = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
    const ids = new Set<string>([nodeId])
    let changed = true
    while (changed) {
      changed = false
      for (const node of all) {
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id)
          changed = true
        }
      }
    }
    const timestamp = now()
    for (const id of ids) {
      const node = all.find((candidate) => candidate.id === id)
      if (!node || node.deletedAt) continue
      await requestToPromise(
        nodesStore.put({
          ...node,
          deletedAt: timestamp,
          deleteBatchId: nodeId,
          updatedAt: timestamp,
          syncVersion: (node.syncVersion ?? 1) + 1,
        }),
      )
    }
    const op: SyncOperation = {
      v: 1,
      opId: makeId(),
      deviceId: binding?.deviceId ?? 'local',
      syncEpoch: binding?.epoch ?? meta.epoch,
      type: 'delete_tree',
      nodeId,
    }
    await enqueue(outboxStore, binding, op, meta.localRevision + 1)
    await bumpMeta(metaStore, meta)
    await transactionDone(transaction)
    emitLocalChange()
    return [...ids]
  } finally {
    db.close()
  }
}

export const localImportNodes = async (inputs: SyncNodeCreateInput[]): Promise<void> => {
  const seenIds = new Set<string>()
  for (const input of inputs) {
    if (seenIds.has(input.id)) throw new Error('导入数据中存在重复 ID')
    seenIds.add(input.id)
  }
  const db = await openDatabase()
  try {
    const transaction = db.transaction([STORE.nodes, STORE.meta, STORE.outbox, STORE.binding], 'readwrite')
    const nodesStore = transaction.objectStore(STORE.nodes)
    const metaStore = transaction.objectStore(STORE.meta)
    const outboxStore = transaction.objectStore(STORE.outbox)
    const bindingStore = transaction.objectStore(STORE.binding)
    const meta = await ensureMetaRow(metaStore, transaction)
    const binding = ((await requestToPromise(bindingStore.get('active'))) ?? null) as BindingRecord | null
    const existing = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
    const existingIds = new Set(existing.map((node) => node.id))
    const idMap = new Map<string, string>()
    for (const input of inputs) if (existingIds.has(input.id)) idMap.set(input.id, makeId())
    const timestamp = now()
    const remapped: SyncNodeCreateInput[] = inputs.map((input) => ({
      ...input,
      id: idMap.get(input.id) ?? input.id,
      parentId: input.parentId === null ? null : (idMap.get(input.parentId) ?? input.parentId),
      positionKey: input.positionKey ?? nextPosition([]),
    }))
    const byParent = new Map<string | null, FavoriteNode[]>()
    for (const input of remapped) {
      const parentKey = input.parentId ?? ''
      const existingSiblings = existing.filter((node) => node.parentId === parentKey && !node.deletedAt)
      const importedSiblings = byParent.get(parentKey) ?? []
      const siblings = [...existingSiblings, ...importedSiblings]
      const positionKey = nextPosition(siblings.map((node) => node.positionKey ?? '').filter(Boolean))
      const node = buildNode({
        id: input.id,
        type: input.type,
        parentId: input.parentId,
        title: input.title,
        order: nextOrder(siblings),
        createdAt: input.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
        positionKey,
        url: input.type === 'bookmark' ? input.url : undefined,
        favicon: input.type === 'bookmark' ? input.favicon : undefined,
      })
      byParent.set(parentKey, [...importedSiblings, node])
      await requestToPromise(nodesStore.put(node))
    }
    const op: SyncOperation = {
      v: 1,
      opId: makeId(),
      deviceId: binding?.deviceId ?? 'local',
      syncEpoch: binding?.epoch ?? meta.epoch,
      type: 'import_nodes',
      nodes: remapped,
    }
    await enqueue(outboxStore, binding, op, meta.localRevision + 1)
    await bumpMeta(metaStore, meta)
    await transactionDone(transaction)
    emitLocalChange()
  } finally {
    db.close()
  }
}

const toLocalNode = (node: SyncNode, order: number): FavoriteNode => {
  const base = {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    order,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    positionKey: node.positionKey,
    syncVersion: node.version,
    deletedAt: node.deletedAt,
    deleteBatchId: null,
    recoveryReason: node.recoveryReason,
  }
  return node.type === 'bookmark' && node.url
    ? { ...base, type: 'bookmark' as const, url: node.url, ...(node.favicon ? { favicon: node.favicon } : {}) }
    : { ...base, type: 'folder' as const }
}

const recomputeOrders = async (nodesStore: IDBObjectStore, all: FavoriteNode[]): Promise<void> => {
  const byParent = new Map<string | null, FavoriteNode[]>()
  for (const node of all) {
    const list = byParent.get(node.parentId) ?? []
    list.push(node)
    byParent.set(node.parentId, list)
  }
  for (const [parentId, siblings] of byParent) {
    const ordered = [...siblings].sort(
      (a, b) => (a.positionKey ?? '').localeCompare(b.positionKey ?? '') || a.id.localeCompare(b.id),
    )
    ordered.forEach((node, index) => {
      if (node.order !== index) nodesStore.put({ ...node, order: index })
    })
    void parentId
  }
}

/**
 * Applies a batch of authoritative remote events atomically and advances the
 * cursor. Never writes new outbox entries.
 */
export const applyRemoteEvents = async (events: SyncEvent[], newCursor: number, newEpoch?: number): Promise<void> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([STORE.nodes, STORE.meta, STORE.outbox], 'readwrite')
    const nodesStore = transaction.objectStore(STORE.nodes)
    const metaStore = transaction.objectStore(STORE.meta)
    const meta = await ensureMetaRow(metaStore, transaction)
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>
      switch (event.type) {
        case 'created': {
          const node = payload.node as SyncNode
          const existing = (await requestToPromise(nodesStore.get(node.id))) as FavoriteNode | undefined
          if (!existing || existing.deletedAt) await requestToPromise(nodesStore.put(toLocalNode(node, 0)))
          break
        }
        case 'patched': {
          const nodeId = payload.nodeId as string
          const patch = payload.patch as NodePatch
          const existing = (await requestToPromise(nodesStore.get(nodeId))) as FavoriteNode | undefined
          if (!existing || existing.deletedAt) break
          await requestToPromise(
            nodesStore.put({
              ...existing,
              title: patch.title ?? existing.title,
              ...(patch.url !== undefined && existing.type === 'bookmark' ? { url: patch.url } : {}),
              ...(patch.favicon !== undefined ? { favicon: patch.favicon } : {}),
              updatedAt: event.createdAt,
              syncVersion: (payload.version as number | undefined) ?? (existing.syncVersion ?? 0) + 1,
            }),
          )
          break
        }
        case 'moved': {
          const nodeId = payload.nodeId as string
          const existing = (await requestToPromise(nodesStore.get(nodeId))) as FavoriteNode | undefined
          if (!existing || existing.deletedAt) break
          await requestToPromise(
            nodesStore.put({
              ...existing,
              parentId: (payload.newParentId as string | null) ?? null,
              positionKey: payload.positionKey as string,
              updatedAt: event.createdAt,
              syncVersion: (payload.version as number | undefined) ?? (existing.syncVersion ?? 0) + 1,
            }),
          )
          break
        }
        case 'deleted': {
          const ids = (payload.ids as string[]) ?? [payload.nodeId as string]
          const all = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
          for (const id of ids) {
            const existing = all.find((node) => node.id === id)
            if (!existing || existing.deletedAt) continue
            await requestToPromise(
              nodesStore.put({
                ...existing,
                deletedAt: event.createdAt,
                deleteBatchId: payload.batchId as string,
                updatedAt: event.createdAt,
              }),
            )
          }
          break
        }
        case 'restored': {
          const ids = (payload.ids as string[]) ?? [payload.nodeId as string]
          const all = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
          for (const id of ids) {
            const existing = all.find((node) => node.id === id)
            if (!existing) continue
            await requestToPromise(
              nodesStore.put({
                ...existing,
                deletedAt: null,
                deleteBatchId: null,
                recoveryReason: null,
                updatedAt: event.createdAt,
              }),
            )
          }
          break
        }
        case 'imported': {
          const nodes = payload.nodes as SyncNode[]
          const existing = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
          const existingIds = new Set(existing.map((node) => node.id))
          for (const node of nodes) {
            if (existingIds.has(node.id)) continue
            await requestToPromise(nodesStore.put(toLocalNode(node, 0)))
          }
          break
        }
        case 'epoch_reset': {
          const nodes = (payload.nodes as SyncNode[]) ?? []
          const existing = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
          const preserved = existing.filter((node) => node.deletedAt)
          const nextAll = [...preserved, ...nodes.map((node) => toLocalNode(node, 0))]
          const seen = new Set<string>()
          for (const node of nextAll) {
            if (seen.has(node.id)) continue
            seen.add(node.id)
            await requestToPromise(nodesStore.put(node))
          }
          break
        }
        case 'positions_rebalanced': {
          const positions = payload.positions as Array<{ id: string; positionKey: string }>
          const existing = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
          for (const entry of positions) {
            const node = existing.find((candidate) => candidate.id === entry.id)
            if (!node) continue
            await requestToPromise(nodesStore.put({ ...node, positionKey: entry.positionKey }))
          }
          break
        }
      }
    }
    const all = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
    await recomputeOrders(nodesStore, all)
    await requestToPromise(metaStore.put({ ...meta, cursor: Math.max(meta.cursor, newCursor), epoch: newEpoch ?? meta.epoch, lastSyncAt: now() }))
    await transactionDone(transaction)
    emitLocalChange()
  } finally {
    db.close()
  }
}

/**
 * Atomically installs a canonical snapshot: replaces the active tree, keeps
 * tombstones, and preserves pending outbox for the reconciliation policy.
 */
export const installSnapshot = async (snapshot: SnapshotPayload): Promise<void> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([STORE.nodes, STORE.meta], 'readwrite')
    const nodesStore = transaction.objectStore(STORE.nodes)
    const metaStore = transaction.objectStore(STORE.meta)
    const meta = await ensureMetaRow(metaStore, transaction)
    const existing = (await requestToPromise(nodesStore.getAll())) as FavoriteNode[]
    const tombstones = existing.filter((node) => node.deletedAt)
    const nodes = snapshot.nodes.map((node) => toLocalNode(node, 0))
    const snapshotIds = new Set(nodes.map((node) => node.id))
    // The snapshot is authoritative: drop active nodes it does not contain
    // while keeping tombstones and pending outbox for the reconciliation
    // policy to decide afterwards.
    for (const node of existing) {
      if (!node.deletedAt && !snapshotIds.has(node.id)) {
        await requestToPromise(nodesStore.delete(node.id))
      }
    }
    for (const node of [...nodes, ...tombstones]) {
      await requestToPromise(nodesStore.put(node))
    }
    await recomputeOrders(nodesStore, nodes)
    await requestToPromise(
      metaStore.put({
        ...meta,
        epoch: snapshot.epoch,
        cursor: Math.max(meta.cursor, snapshot.seq),
        lastSyncAt: now(),
      }),
    )
    await transactionDone(transaction)
    emitLocalChange()
  } finally {
    db.close()
  }
}

/** Captures a consistent local snapshot: active nodes plus the local revision. */
export const captureLocalSnapshot = async (): Promise<{ nodes: SyncNode[]; localRevision: number }> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction([STORE.nodes, STORE.meta], 'readonly')
    const nodesStore = transaction.objectStore(STORE.nodes)
    const metaStore = transaction.objectStore(STORE.meta)
    const [nodes, meta] = await Promise.all([
      requestToPromise(nodesStore.getAll()) as Promise<FavoriteNode[]>,
      requestToPromise(metaStore.get('meta')) as Promise<LocalMeta | undefined>,
    ])
    await transactionDone(transaction)
    const active = nodes.filter((node) => !node.deletedAt)
    return {
      nodes: active.map((node) => ({
        id: node.id,
        type: node.type,
        parentId: node.parentId,
        title: node.title,
        ...(node.type === 'bookmark' ? { url: node.url, ...(node.favicon ? { favicon: node.favicon } : {}) } : {}),
        positionKey: node.positionKey ?? nextPosition([]),
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        version: node.syncVersion ?? 1,
        deletedAt: null,
        recoveryReason: node.recoveryReason ?? null,
      })),
      localRevision: (meta ?? defaultMeta()).localRevision,
    }
  } finally {
    db.close()
  }
}

/** Replaces all outbox entries (used when a policy invalidates pending ops). */
export const clearOutbox = async (): Promise<void> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(STORE.outbox, 'readwrite')
    const store = transaction.objectStore(STORE.outbox)
    const all = (await requestToPromise(store.getAll())) as OutboxEntry[]
    for (const entry of all) await requestToPromise(store.delete(entry.id))
    await transactionDone(transaction)
    emitLocalChange()
  } finally {
    db.close()
  }
}

/**
 * Atomically replaces the pending outbox with the given entries. Used by the
 * sync engine to drop confirmed or invalidated operations while keeping the
 * rest of the queue intact.
 */
export const replaceOutbox = async (keep: OutboxEntry[]): Promise<void> => {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(STORE.outbox, 'readwrite')
    const store = transaction.objectStore(STORE.outbox)
    const keepIds = new Set(keep.map((entry) => entry.id))
    const all = (await requestToPromise(store.getAll())) as OutboxEntry[]
    for (const entry of all) {
      if (!keepIds.has(entry.id)) await requestToPromise(store.delete(entry.id))
    }
    for (const entry of keep) await requestToPromise(store.put(entry))
    await transactionDone(transaction)
    emitLocalChange()
  } finally {
    db.close()
  }
}

export { nextPosition }
