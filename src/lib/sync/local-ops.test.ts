import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SnapshotPayload, SyncEvent } from '@webwings/sync-protocol'
import type { FavoriteNode } from '../../types'
import { STORE, getAll, get, openDatabase } from './idb'
import {
  applyRemoteEvents,
  clearOutbox,
  installSnapshot,
  localCreateNode,
  localDeleteTree,
  localImportNodes,
  localPatchNode,
  readBinding,
  readMeta,
  readOutbox,
  writeBinding,
  type BindingRecord,
} from './local-ops'

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

const binding = (overrides: Partial<BindingRecord> = {}): BindingRecord => ({
  id: 'active',
  serverUrl: 'https://sync.example.com/v1',
  origin: 'https://sync.example.com',
  instanceId: 'srv_1',
  keyId: 'key-1',
  keyPrefix: 'srk_sync_ab',
  role: 'sync',
  capabilities: ['sync'],
  deviceId: 'dev-1',
  refreshToken: 'refresh-1',
  accessToken: 'access-1',
  accessTokenExpiresAt: '2099-01-01T00:00:00Z',
  epoch: 1,
  cursor: 0,
  lastSyncAt: null,
  ...overrides,
})

describe('IndexedDB migration and local sync ops', () => {
  beforeEach(deleteDatabase)

  it('migrates a version 1 database preserving nodes and deriving stable positions', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('webwings', 1)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('nodes', { keyPath: 'id' })
        store.createIndex('parentId', 'parentId', { unique: false })
        store.createIndex('type', 'type', { unique: false })
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('nodes', 'readwrite')
        const store = tx.objectStore('nodes')
        const timestamp = new Date().toISOString()
        store.add({ id: 'older', type: 'bookmark', parentId: null, title: 'older', order: 1, url: 'https://a.example', createdAt: timestamp, updatedAt: timestamp })
        store.add({ id: 'newer', type: 'bookmark', parentId: null, title: 'newer', order: 0, url: 'https://b.example', createdAt: timestamp, updatedAt: timestamp })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })

    const db = await openDatabase()
    const nodes = (await getAll(STORE.nodes)) as Array<Record<string, unknown>>
    db.close()
    expect(nodes).toHaveLength(2)
    const newer = nodes.find((node) => node.id === 'newer')!
    const older = nodes.find((node) => node.id === 'older')!
    expect(typeof newer.positionKey).toBe('string')
    expect(typeof older.positionKey).toBe('string')
    expect(String(newer.positionKey) < String(older.positionKey)).toBe(true)
    expect(nodes.every((node) => node.syncVersion === 1 && node.deletedAt === null)).toBe(true)
  })

  it('creates nodes locally without outbox when unbound', async () => {
    await localCreateNode({
      id: 'n1',
      type: 'bookmark',
      parentId: null,
      title: 'one',
      url: 'https://one.example',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(await readOutbox()).toHaveLength(0)
    expect((await readMeta())?.localRevision).toBe(1)
  })

  it('writes outbox entries atomically when bound and clears them on demand', async () => {
    await writeBinding(binding())
    await localCreateNode({
      id: 'n1',
      type: 'bookmark',
      parentId: null,
      title: 'one',
      url: 'https://one.example',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await localPatchNode('n1', { title: 'one updated' }, 1)
    await localDeleteTree('n1')
    const outbox = await readOutbox()
    expect(outbox.map((entry) => entry.op.type)).toEqual(['create_node', 'patch_node', 'delete_tree'])
    expect(outbox.every((entry) => entry.deviceId === 'dev-1' && entry.epoch === 1)).toBe(true)
    expect((await readMeta())?.localRevision).toBe(3)

    await clearOutbox()
    expect(await readOutbox()).toHaveLength(0)
  })

  it('applies remote events atomically and advances the cursor without outbox writes', async () => {
    const events: SyncEvent[] = [
      {
        syncEpoch: 1,
        seq: 1,
        opId: 'op-1',
        deviceId: 'dev-2',
        type: 'created',
        payload: {
          node: {
            id: 'remote-1',
            type: 'bookmark',
            parentId: null,
            title: 'remote',
            url: 'https://remote.example',
            positionKey: '0000000000000000000000000001000000000000',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
            deletedAt: null,
            recoveryReason: null,
          },
        },
        createdAt: new Date().toISOString(),
      },
      {
        syncEpoch: 1,
        seq: 2,
        opId: 'op-2',
        deviceId: 'dev-2',
        type: 'deleted',
        payload: { nodeId: 'remote-1', ids: ['remote-1'] },
        createdAt: new Date().toISOString(),
      },
    ]
    await applyRemoteEvents(events, 2, 1)
    const nodes = await getAll<FavoriteNode>(STORE.nodes)
    expect(nodes.find((node) => node.id === 'remote-1')).toMatchObject({ deletedAt: expect.any(String) })
    const meta = await readMeta()
    expect(meta?.cursor).toBe(2)
    expect(meta?.epoch).toBe(1)
    expect(await readOutbox()).toHaveLength(0)
  })

  it('installs snapshots while preserving pending outbox and tombstones', async () => {
    await writeBinding(binding())
    await localCreateNode({
      id: 'local-1',
      type: 'bookmark',
      parentId: null,
      title: 'local',
      url: 'https://local.example',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const snapshot: SnapshotPayload = {
      v: 1,
      epoch: 1,
      seq: 7,
      digest: 'a'.repeat(64),
      nodes: [
        {
          id: 'cloud-1',
          type: 'bookmark',
          parentId: null,
          title: 'cloud',
          url: 'https://cloud.example',
          positionKey: '0000000000000000000000000002000000000000',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 3,
          deletedAt: null,
          recoveryReason: null,
        },
      ],
    }
    await installSnapshot(snapshot)
    const nodes = await getAll<FavoriteNode>(STORE.nodes)
    expect(nodes.map((node) => node.id).sort()).toEqual(['cloud-1'])
    expect(nodes.find((node) => node.id === 'cloud-1')).toBeTruthy()
    expect(nodes.find((node) => node.id === 'local-1')).toBeUndefined()
    expect((await readMeta())?.cursor).toBe(7)
    expect((await readMeta())?.epoch).toBe(1)
    expect((await readOutbox()).length).toBeGreaterThan(0)
  })

  it('imports nodes with id remapping when bound', async () => {
    await writeBinding(binding())
    await localCreateNode({
      id: 'existing',
      type: 'bookmark',
      parentId: null,
      title: 'existing',
      url: 'https://existing.example',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await localImportNodes([
      {
        id: 'existing',
        type: 'folder',
        parentId: null,
        title: 'folder',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'kid',
        type: 'bookmark',
        parentId: 'existing',
        title: 'kid',
        url: 'https://kid.example',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    const nodes = await getAll<FavoriteNode>(STORE.nodes)
    expect(nodes).toHaveLength(3)
    const importedFolder = nodes.find((node) => node.type === 'folder' && node.title === 'folder')!
    const kid = nodes.find((node) => node.title === 'kid')!
    expect(importedFolder.id).not.toBe('existing')
    expect(kid.parentId).toBe(importedFolder.id)
    const outbox = await readOutbox()
    expect(outbox[0].op.type).toBe('create_node')
    expect(outbox[1].op.type).toBe('import_nodes')
  })

  it('stores binding records without raw srkey material', async () => {
    await writeBinding(binding())
    const stored = await get<BindingRecord>(STORE.binding, 'active')
    expect(stored?.keyPrefix).toBe('srk_sync_ab')
    expect(JSON.stringify(stored)).not.toMatch(/srk_(admin|sync)_[A-Za-z0-9_-]{43}/)
    expect(stored?.refreshToken).toBe('refresh-1')
    expect(await readBinding()).toMatchObject({ instanceId: 'srv_1' })
  })
})
