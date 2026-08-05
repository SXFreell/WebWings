import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncNodeCreateInput, SyncOperation } from '@webwings/sync-protocol'
import { bootstrapAdmin } from '../src/keys'
import { DeviceRepo } from '../src/repos/devices'
import { KeyRepo } from '../src/repos/keys'
import { NodeRepo } from '../src/repos/nodes'
import { SessionService, type AuthContext } from '../src/sessions'
import { OperationService } from '../src/services/operations'
import { createPgMemPool, testConfig } from './helpers/pgmem'

const now = () => new Date().toISOString()

const nodeInput = (id: string, overrides: Partial<SyncNodeCreateInput> = {}): SyncNodeCreateInput => ({
  id,
  type: 'bookmark',
  parentId: null,
  title: id,
  url: 'https://example.com',
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
})

const op = (opId: string, epoch: number, body: Record<string, unknown>): SyncOperation =>
  ({ v: 1, opId, deviceId: 'dev-1', syncEpoch: epoch, ...body }) as SyncOperation

describe('payload and tree limits', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>
  let config: ReturnType<typeof testConfig>
  let ctx: AuthContext
  let namespaceId: string
  let ops: OperationService

  beforeEach(async () => {
    pool = await createPgMemPool()
    config = testConfig()
    const boot = await bootstrapAdmin(pool, config)
    const key = (await new KeyRepo(pool).list())[0]
    namespaceId = key.namespaceId
    const sessions = new SessionService(pool, config)
    const device = await new DeviceRepo(pool).createDevice(key.id, 'limit device', null)
    const issued = await sessions.issueForDevice(key, device.id)
    ctx = (await sessions.authenticateAccess(issued.accessToken))!
    ops = new OperationService(pool, config.maxNodesPerImport)
  })

  it('rejects imports larger than the configured limit', async () => {
    const nodes = Array.from({ length: config.maxNodesPerImport + 1 }, (_, i) => nodeInput(`bulk-${i}`))
    const [receipt] = await ops.push(ctx, [op('op-oversized', 1, { type: 'import_nodes', nodes })])
    expect(receipt.status).toBe('rejected')
    expect(receipt.errorCode).toBeTruthy()
    expect((await new NodeRepo(pool).getAll(namespaceId)).length).toBe(0)
  })

  it('accepts deep folder chains without false cycle rejections', async () => {
    const depth = 150
    const nodes = Array.from({ length: depth }, (_, i) =>
      nodeInput(`d${i}`, { type: 'folder', parentId: i === 0 ? null : `d${i - 1}`, title: `folder ${i}`, url: undefined }),
    )
    const receipts = await ops.push(ctx, [op('op-deep', 1, { type: 'import_nodes', nodes })])
    expect(receipts[0].status).toBe('accepted')
    const stored = await new NodeRepo(pool).getAll(namespaceId)
    expect(stored.filter((node) => !node.deletedAt)).toHaveLength(depth)
  })

  it('applies a large tree delete atomically and paginates the event stream', async () => {
    const folder = nodeInput('root', { type: 'folder', url: undefined })
    const kids = Array.from({ length: 300 }, (_, i) => nodeInput(`kid-${i}`, { parentId: 'root' }))
    await ops.push(ctx, [
      op('op-root', 1, { type: 'create_node', node: folder }),
      ...kids.slice(0, 199).map((node, i) => op(`op-kid-${i}`, 1, { type: 'create_node', node })),
    ])
    await ops.push(ctx, [
      ...kids.slice(199).map((node, i) => op(`op-kid-${i + 199}`, 1, { type: 'create_node', node })),
    ])
    const deleted = await ops.push(ctx, [op('op-delete-all', 1, { type: 'delete_tree', nodeId: 'root' })])
    expect(deleted[0].status).toBe('accepted')
    const active = (await new NodeRepo(pool).getAll(namespaceId)).filter((node) => !node.deletedAt)
    expect(active).toHaveLength(0)

    // Paginate the full event stream (301 creates + 1 delete = 302 events).
    const syncService = await import('../src/services/sync').then((m) => m.SyncService)
    let total = 0
    let cursor = 0
    for (;;) {
      const page = await new syncService(pool, config, ops).pull(ctx, { after: cursor, limit: 100 })
      if (page.status !== 'ok') throw new Error(`unexpected snapshot-required response: ${page.status}`)
      total += page.events.length
      if (page.events.length === 0) break
      cursor = page.events[page.events.length - 1].seq
    }
    expect(total).toBe(302)
  })
})
