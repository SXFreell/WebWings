import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncOperation } from '@webwings/sync-protocol'
import { bootstrapAdmin } from '../src/keys'
import { DeviceRepo } from '../src/repos/devices'
import { KeyRepo } from '../src/repos/keys'
import { NamespaceRepo } from '../src/repos/namespaces'
import { NodeRepo } from '../src/repos/nodes'
import { SessionService, type AuthContext } from '../src/sessions'
import { OperationService } from '../src/services/operations'
import { createPgMemPool, testConfig } from './helpers/pgmem'

const now = () => new Date().toISOString()

const node = (id: string, overrides: Partial<Record<string, unknown>> = {}) => ({
  id,
  type: 'bookmark',
  parentId: null,
  title: `title ${id}`,
  url: 'https://example.com',
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
})

const op = (opId: string, epoch: number, body: Record<string, unknown>): SyncOperation =>
  ({ v: 1, opId, deviceId: 'dev-1', syncEpoch: epoch, ...body }) as SyncOperation

describe('bookmark operations', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>
  let ctx: AuthContext
  let ops: OperationService
  let namespaceId: string

  beforeEach(async () => {
    pool = await createPgMemPool()
    const config = testConfig()
    const boot = await bootstrapAdmin(pool, config)
    const key = await new KeyRepo(pool).findBySecretHash(
      (await import('../src/crypto')).hashSrkey(config.srkeyPepper, boot.generatedSrkey!),
    )
    const device = await new DeviceRepo(pool).createDevice(key!.id, 'ops device', null)
    const sessions = new SessionService(pool, config)
    const issued = await sessions.issueForDevice(key!, device.id)
    ctx = (await sessions.authenticateAccess(issued.accessToken))!
    namespaceId = key!.namespaceId
    ops = new OperationService(pool, config.maxNodesPerImport)
  })

  const push = async (operations: SyncOperation[]) => {
    const receipts = await ops.push(ctx, operations)
    return receipts
  }

  it('creates nodes idempotently with deterministic sibling order', async () => {
    const first = await push([op('op-1', 1, { type: 'create_node', node: node('a', { positionKey: '1000' }) })])
    const retry = await push([op('op-1', 1, { type: 'create_node', node: node('a') })])
    expect(first[0].status).toBe('accepted')
    expect(retry[0].status).toBe('accepted')
    expect(retry[0].seq).toBe(first[0].seq)

    await push([op('op-2', 1, { type: 'create_node', node: node('b', { positionKey: '1000' }) })])
    const children = await new NodeRepo(pool).getActiveChildren(namespaceId, '')
    expect(children.map((child) => child.id)).toEqual(['a', 'b'])
    expect(children[0].positionKey).toBe('0000000000000000000000000000000000001000')
    expect(children[1].positionKey).not.toBe('1000')
  })

  it('merges different-field patches and lets later same-field writes win', async () => {
    await push([op('op-1', 1, { type: 'create_node', node: node('a') })])
    await push([op('op-2', 1, { type: 'patch_node', nodeId: 'a', baseVersion: 1, patch: { title: 'renamed' } })])
    await push([op('op-3', 1, { type: 'patch_node', nodeId: 'a', baseVersion: 1, patch: { url: 'https://other.example' } })])
    const row = await new NodeRepo(pool).get(namespaceId, 'a')
    expect(row?.title).toBe('renamed')
    expect(row?.url).toBe('https://other.example')

    await push([op('op-4', 1, { type: 'patch_node', nodeId: 'a', baseVersion: 2, patch: { title: 'final' } })])
    const after = await new NodeRepo(pool).get(namespaceId, 'a')
    expect(after?.title).toBe('final')
    expect(after?.version).toBe(4)
  })

  it('rejects stale patches against deleted nodes without resurrecting them', async () => {
    await push([op('op-1', 1, { type: 'create_node', node: node('a') })])
    await push([op('op-2', 1, { type: 'delete_tree', nodeId: 'a' })])
    const stale = await push([op('op-3', 1, { type: 'patch_node', nodeId: 'a', baseVersion: 1, patch: { title: 'zombie' } })])
    expect(stale[0].status).toBe('rejected')
    expect(stale[0].errorCode).toBe('node_deleted')
    expect((await new NodeRepo(pool).get(namespaceId, 'a'))?.deletedAt).not.toBeNull()
  })

  it('rejects moves that create cycles and accepts valid moves', async () => {
    await push([
      op('op-1', 1, { type: 'create_node', node: node('folder', { type: 'folder', url: undefined }) }),
      op('op-2', 1, { type: 'create_node', node: node('sub', { type: 'folder', url: undefined, parentId: 'folder' }) }),
    ])
    const cycle = await push([op('op-3', 1, { type: 'move_node', nodeId: 'folder', newParentId: 'sub' })])
    expect(cycle[0].status).toBe('rejected')
    expect(cycle[0].errorCode).toBe('cycle')

    const moved = await push([op('op-4', 1, { type: 'move_node', nodeId: 'folder', newParentId: null })])
    expect(moved[0].status).toBe('accepted')
  })

  it('deletes a directory tree atomically and restores it', async () => {
    await push([
      op('op-1', 1, { type: 'create_node', node: node('a', { type: 'folder', url: undefined }) }),
      op('op-2', 1, { type: 'create_node', node: node('b', { parentId: 'a' }) }),
      op('op-3', 1, { type: 'create_node', node: node('c', { type: 'folder', url: undefined, parentId: 'a' }) }),
      op('op-4', 1, { type: 'create_node', node: node('d', { parentId: 'c' }) }),
    ])
    const deleted = await push([op('op-5', 1, { type: 'delete_tree', nodeId: 'a' })])
    expect(deleted[0].status).toBe('accepted')
    const repo = new NodeRepo(pool)
    for (const id of ['a', 'b', 'c', 'd']) expect((await repo.get(namespaceId, id))?.deletedAt).not.toBeNull()

    const restored = await push([op('op-6', 1, { type: 'restore_node', nodeId: 'a' })])
    expect(restored[0].status).toBe('accepted')
    for (const id of ['a', 'b', 'c', 'd']) expect((await repo.get(namespaceId, id))?.deletedAt).toBeNull()
  })

  it('moves creates under a deleted parent into the root recovery area', async () => {
    await push([op('op-1', 1, { type: 'create_node', node: node('folder', { type: 'folder', url: undefined }) })])
    await push([op('op-2', 1, { type: 'delete_tree', nodeId: 'folder' })])
    const created = await push([op('op-3', 1, { type: 'create_node', node: node('orphan', { parentId: 'folder' }) })])
    expect(created[0].status).toBe('accepted')
    const row = await new NodeRepo(pool).get(namespaceId, 'orphan')
    expect(row?.parentId).toBe('')
    expect(row?.recoveryReason).toBe('parent_deleted')
  })

  it('imports atomically, remaps colliding ids and rejects invalid batches wholesale', async () => {
    await push([op('op-1', 1, { type: 'create_node', node: node('existing') })])
    const imported = await push([
      op('op-2', 1, {
        type: 'import_nodes',
        nodes: [node('existing'), node('kid', { parentId: 'existing' })],
      }),
    ])
    expect(imported[0].status).toBe('accepted')
    const repo = new NodeRepo(pool)
    const all = await repo.getAll(namespaceId)
    expect(all.length).toBe(3)
    const remapped = all.find((row) => row.id !== 'existing' && row.parentId !== '')
    expect(remapped?.parentId).not.toBe('existing')
    expect(remapped?.parentId).not.toBe(remapped?.id)

    const invalid = await push([
      op('op-3', 1, { type: 'import_nodes', nodes: [node('x', { parentId: 'missing-parent' }), node('y')] }),
    ])
    expect(invalid[0].status).toBe('rejected')
    expect((await repo.getAll(namespaceId)).length).toBe(3)
  })

  it('returns epoch mismatch receipts for stale epoch operations', async () => {
    await push([op('op-1', 1, { type: 'create_node', node: node('a') })])
    await new NamespaceRepo(pool).bumpEpoch(namespaceId)
    const stale = await push([op('op-2', 1, { type: 'create_node', node: node('b') })])
    expect(stale[0].status).toBe('epoch_mismatch')
    const staleAgain = await push([op('op-2', 1, { type: 'create_node', node: node('b') })])
    expect(staleAgain[0].status).toBe('epoch_mismatch')
    expect((await new NodeRepo(pool).get(namespaceId, 'b'))).toBeNull()
  })

  it('resolves competing moves, deletes and inserts deterministically', async () => {
    await push([
      op('op-1', 1, { type: 'create_node', node: node('folder', { type: 'folder', url: undefined }) }),
      op('op-2', 1, { type: 'create_node', node: node('folder2', { type: 'folder', url: undefined }) }),
      op('op-3', 1, { type: 'create_node', node: node('item') }),
    ])
    await push([op('op-4', 1, { type: 'move_node', nodeId: 'item', newParentId: 'folder' })])
    await push([op('op-5', 1, { type: 'move_node', nodeId: 'item', newParentId: 'folder2' })])
    expect((await new NodeRepo(pool).get(namespaceId, 'item'))?.parentId).toBe('folder2')

    await push([op('op-6', 1, { type: 'delete_tree', nodeId: 'folder2' })])
    const edit = await push([op('op-7', 1, { type: 'patch_node', nodeId: 'item', baseVersion: 1, patch: { title: 'late' } })])
    expect(edit[0].status).toBe('rejected')
  })
})
