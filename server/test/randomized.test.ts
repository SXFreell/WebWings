import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncNodeCreateInput, SyncOperation } from '@webwings/sync-protocol'
import { bootstrapAdmin } from '../src/keys'
import { DeviceRepo } from '../src/repos/devices'
import { KeyRepo } from '../src/repos/keys'
import { NodeRepo } from '../src/repos/nodes'
import { SessionService, type AuthContext } from '../src/sessions'
import { OperationService } from '../src/services/operations'
import { createPgMemPool, testConfig } from './helpers/pgmem'

const mulberry32 = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const now = () => new Date().toISOString()

const nodeInput = (id: string): SyncNodeCreateInput => ({
  id,
  type: 'bookmark',
  parentId: null,
  title: id,
  url: 'https://example.com',
  createdAt: now(),
  updatedAt: now(),
})

describe('randomized multi-device operations', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>
  let config: ReturnType<typeof testConfig>
  let ops: OperationService
  let ctxA: AuthContext
  let ctxB: AuthContext
  let namespaceId: string

  beforeEach(async () => {
    pool = await createPgMemPool()
    config = testConfig()
    const boot = await bootstrapAdmin(pool, config)
    const key = (await new KeyRepo(pool).list())[0]
    namespaceId = key.namespaceId
    const sessions = new SessionService(pool, config)
    const deviceA = await new DeviceRepo(pool).createDevice(key.id, 'device A', null)
    const deviceB = await new DeviceRepo(pool).createDevice(key.id, 'device B', null)
    const issuedA = await sessions.issueForDevice(key, deviceA.id)
    const issuedB = await sessions.issueForDevice(key, deviceB.id)
    ctxA = (await sessions.authenticateAccess(issuedA.accessToken))!
    ctxB = (await sessions.authenticateAccess(issuedB.accessToken))!
    ops = new OperationService(pool, config.maxNodesPerImport)
  })

  it('converges under randomized interleaved ops with duplicate deliveries', async () => {
    const rng = mulberry32(0xC0FFEE)
    const ids: string[] = []
    const operations: SyncOperation[] = []
    const makeOp = (opId: string, deviceId: string, body: Record<string, unknown>): SyncOperation =>
      ({ v: 1, opId, deviceId, syncEpoch: 1, ...body }) as SyncOperation

    for (let i = 0; i < 10; i += 1) {
      const id = `n${ids.length}`
      ids.push(id)
      operations.push(makeOp(`op-create-${id}`, ctxA.deviceId, { type: 'create_node', node: nodeInput(id) }))
    }
    for (let i = 0; i < 50; i += 1) {
      const id = ids[Math.floor(rng() * ids.length)]
      const kind = Math.floor(rng() * 5)
      const opId = `op-rand-${i}`
      if (kind === 0) {
        operations.push(makeOp(opId, ctxB.deviceId, { type: 'patch_node', nodeId: id, baseVersion: 1, patch: { title: `renamed-${i}` } }))
      } else if (kind === 1) {
        operations.push(makeOp(opId, ctxA.deviceId, { type: 'move_node', nodeId: id, newParentId: null }))
      } else if (kind === 2) {
        operations.push(makeOp(opId, ctxB.deviceId, { type: 'delete_tree', nodeId: id }))
      } else if (kind === 3) {
        const newId = `n${ids.length}`
        ids.push(newId)
        operations.push(makeOp(opId, ctxA.deviceId, { type: 'create_node', node: nodeInput(newId) }))
      } else {
        const newId = `n${ids.length}`
        ids.push(newId)
        operations.push(makeOp(opId, ctxB.deviceId, { type: 'import_nodes', nodes: [nodeInput(newId)] }))
      }
    }
    const deliveries = [...operations]
    for (let i = 0; i < operations.length; i += 7) deliveries.push({ ...operations[i] })

    const firstStatus = new Map<string, string>()
    for (const op of deliveries) {
      const ctx = op.deviceId === ctxA.deviceId ? ctxA : ctxB
      const [receipt] = await ops.push(ctx, [op])
      expect(receipt.status).not.toBe('epoch_mismatch')
      const known = firstStatus.get(op.opId)
      if (known !== undefined) expect(receipt.status).toBe(known)
      else firstStatus.set(op.opId, receipt.status)
    }

    const active = (await new NodeRepo(pool).getAll(namespaceId)).filter((node) => !node.deletedAt)
    expect(new Set(active.map((node) => node.id)).size).toBe(active.length)
    const byId = new Map(active.map((node) => [node.id, node]))
    for (const node of active) {
      if (node.parentId === '') continue
      expect(byId.has(node.parentId)).toBe(true)
    }
    for (const node of active) {
      const seen = new Set<string>()
      let parent: string | null = node.parentId
      while (parent && parent !== '') {
        expect(seen.has(parent)).toBe(false)
        seen.add(parent)
        parent = byId.get(parent)?.parentId ?? null
      }
    }

    const replayPool = await createPgMemPool()
    await bootstrapAdmin(replayPool, config)
    const replayKey = (await new KeyRepo(replayPool).list())[0]
    const replaySessions = new SessionService(replayPool, config)
    const replayDevice = await new DeviceRepo(replayPool).createDevice(replayKey.id, 'replay', null)
    const replayIssued = await replaySessions.issueForDevice(replayKey, replayDevice.id)
    const replayCtx = (await replaySessions.authenticateAccess(replayIssued.accessToken))!
    const replayOps = new OperationService(replayPool, config.maxNodesPerImport)
    for (const op of deliveries) await replayOps.push(replayCtx, [op])
    const replayActive = (await new NodeRepo(replayPool).getAll(replayKey.namespaceId)).filter((node) => !node.deletedAt)
    expect(replayActive.map((node) => node.id).sort()).toEqual(active.map((node) => node.id).sort())
  })
})
