import { beforeEach, describe, expect, it } from 'vitest'
import type { SyncNodeCreateInput, SyncOperation } from '@webwings/sync-protocol'
import { bootstrapAdmin, KeyService } from '../src/keys'
import { SessionService, type AuthContext } from '../src/sessions'
import { BindService } from '../src/services/bind'
import { OperationService } from '../src/services/operations'
import { createPgMemPool, testConfig } from './helpers/pgmem'

const now = () => new Date().toISOString()

const node = (id: string, overrides: Partial<SyncNodeCreateInput> = {}): SyncNodeCreateInput => ({
  id,
  type: 'bookmark',
  parentId: null,
  title: `title ${id}`,
  url: 'https://example.com',
  positionKey: '1000',
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
})

const op = (opId: string, epoch: number, body: Record<string, unknown>): SyncOperation =>
  ({ v: 1, opId, deviceId: 'dev-x', syncEpoch: epoch, ...body }) as SyncOperation

describe('bind lifecycle', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>
  let config: ReturnType<typeof testConfig>
  let boot: Awaited<ReturnType<typeof bootstrapAdmin>>
  let keyService: KeyService
  let bindService: BindService
  let operationService: OperationService
  let sessionService: SessionService

  beforeEach(async () => {
    pool = await createPgMemPool()
    config = testConfig()
    boot = await bootstrapAdmin(pool, config)
    keyService = new KeyService(pool, config)
    sessionService = new SessionService(pool, config)
    bindService = new BindService(pool, config, sessionService)
    operationService = new OperationService(pool, config.maxNodesPerImport)
  })

  const createSyncKey = async () => {
    const created = await keyService.createKey('admin', 'bind test')
    return created
  }

  const authenticate = async (accessToken: string): Promise<AuthContext> => {
    const ctx = await sessionService.authenticateAccess(accessToken)
    if (!ctx) throw new Error('failed to authenticate device session')
    return ctx
  }

  const complete = async (
    srkey: string,
    strategy: 'initialize_cloud' | 'use_cloud' | 'use_local' | 'merge',
    localNodes: ReturnType<typeof node>[],
    operationId = 'op-bind-1',
  ) => {
    const started = await bindService.start({ v: 1, srkey, deviceName: 'test' })
    const cloud = await bindService.cloudSnapshot(started.bindToken, started.bindSessionId)
    await bindService.backupProof(started.bindToken, started.bindSessionId, {
      cloudDigest: cloud.digest,
      localDigest: 'a'.repeat(64),
      localRevision: localNodes.length,
      downloadState: 'complete',
      downloadedAt: now(),
    })
    return bindService.complete(started.bindToken, started.bindSessionId, {
      v: 1,
      operationId,
      strategy,
      localNodes,
      expected: {
        cloudSeq: started.cloud.cloudSeq,
        syncEpoch: started.cloud.syncEpoch,
        localRevision: localNodes.length,
      },
    })
  }

  it('locks an immutable cloud snapshot for the bind session', async () => {
    const key = await createSyncKey()
    const first = await complete(key.srkey, 'initialize_cloud', [node('a')])
    const token = first.deviceSession.accessToken
    const ctx = await authenticate(token)
    await operationService.push(ctx, [op('op-push-1', 1, { type: 'create_node', node: node('b') })])

    const started = await bindService.start({ v: 1, srkey: key.srkey, deviceName: 'second device' })
    expect(started.cloud.hasData).toBe(true)
    const locked = await bindService.cloudSnapshot(started.bindToken, started.bindSessionId)
    expect(locked.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(locked.cloudSeq).toBe(started.cloud.cloudSeq)

    // A later push advances the namespace sequence but not the locked snapshot.
    await operationService.push(ctx, [op('op-push-2', 1, { type: 'create_node', node: node('c') })])
    const stillLocked = await bindService.cloudSnapshot(started.bindToken, started.bindSessionId)
    expect(stillLocked.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(stillLocked.digest).toBe(locked.digest)
  })

  it('completes idempotently by operation id and rejects different operations', async () => {
    const key = await createSyncKey()
    const first = await complete(key.srkey, 'initialize_cloud', [node('a')])
    const started = await bindService.start({ v: 1, srkey: key.srkey, deviceName: 'again' })
    const cloud = await bindService.cloudSnapshot(started.bindToken, started.bindSessionId)
    await bindService.backupProof(started.bindToken, started.bindSessionId, {
      cloudDigest: cloud.digest,
      localDigest: 'a'.repeat(64),
      localRevision: 0,
      downloadState: 'complete',
      downloadedAt: now(),
    })
    const request = {
      v: 1 as const,
      operationId: 'op-bind-same',
      strategy: 'use_cloud' as const,
      localNodes: [],
      expected: { cloudSeq: started.cloud.cloudSeq, syncEpoch: started.cloud.syncEpoch, localRevision: 0 },
    }
    const firstResult = await bindService.complete(started.bindToken, started.bindSessionId, request)
    const retried = await bindService.complete(started.bindToken, started.bindSessionId, request)
    expect(retried.deviceSession.deviceId).toBe(firstResult.deviceSession.deviceId)
    expect(retried.snapshot.seq).toBe(firstResult.snapshot.seq)
    await expect(bindService.complete(started.bindToken, started.bindSessionId, { ...request, operationId: 'op-bind-other' }))
      .rejects.toMatchObject({ statusCode: 409 })
    void first
  })

  it('use_local bumps the epoch and rejects old-epoch device operations', async () => {
    const key = await createSyncKey()
    await complete(key.srkey, 'initialize_cloud', [node('a')])
    const replaced = await complete(key.srkey, 'use_local', [node('z')], 'op-bind-local')
    expect(replaced.snapshot.epoch).toBe(2)
    expect(replaced.snapshot.nodes.map((n) => n.id)).toEqual(['z'])

    const ctx = await authenticate(replaced.deviceSession.accessToken)
    const receipts = await operationService.push(ctx, [op('op-stale', 1, { type: 'create_node', node: node('stale') })])
    expect(receipts[0].status).toBe('epoch_mismatch')
    const current = await operationService.push(ctx, [op('op-fresh', 2, { type: 'create_node', node: node('fresh') })])
    expect(current[0].status).toBe('accepted')
  })

  it('use_cloud returns the locked cloud snapshot and discards local nodes', async () => {
    const key = await createSyncKey()
    await complete(key.srkey, 'initialize_cloud', [node('a')])
    const result = await complete(key.srkey, 'use_cloud', [node('z')], 'op-bind-cloud')
    expect(result.snapshot.nodes.map((n) => n.id)).toEqual(['a'])
    expect(result.snapshot.epoch).toBe(1)
  })

  it('merge preserves cloud nodes and remaps colliding local ids', async () => {
    const key = await createSyncKey()
    await complete(key.srkey, 'initialize_cloud', [node('shared')])
    const merged = await complete(key.srkey, 'merge', [node('shared'), node('local-only')], 'op-bind-merge')
    const ids = merged.snapshot.nodes.map((n) => n.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toContain('shared')
    expect(ids).toContain('local-only')
    expect(merged.snapshot.nodes.filter((n) => n.title === 'title shared')).toHaveLength(2)
  })

  it('rejects completion with a version_changed conflict when the cloud advanced', async () => {
    const key = await createSyncKey()
    const first = await complete(key.srkey, 'initialize_cloud', [node('a')])
    const ctx = await authenticate(first.deviceSession.accessToken)

    const started = await bindService.start({ v: 1, srkey: key.srkey, deviceName: 'racer' })
    const cloud = await bindService.cloudSnapshot(started.bindToken, started.bindSessionId)
    await bindService.backupProof(started.bindToken, started.bindSessionId, {
      cloudDigest: cloud.digest,
      localDigest: 'a'.repeat(64),
      localRevision: 0,
      downloadState: 'complete',
      downloadedAt: now(),
    })
    await operationService.push(ctx, [op('op-race', 1, { type: 'create_node', node: node('racer') })])
    await expect(bindService.complete(started.bindToken, started.bindSessionId, {
      v: 1,
      operationId: 'op-bind-race',
      strategy: 'use_cloud',
      localNodes: [],
      expected: { cloudSeq: started.cloud.cloudSeq, syncEpoch: started.cloud.syncEpoch, localRevision: 0 },
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('expires bind sessions and refuses late completion', async () => {
    const key = await createSyncKey()
    const started = await bindService.start({ v: 1, srkey: key.srkey, deviceName: 'late' })
    await pool.query('UPDATE bind_sessions SET expires_at = $1 WHERE id = $2', [
      new Date(Date.now() - 60_000).toISOString(),
      started.bindSessionId,
    ])
    await expect(bindService.complete(started.bindToken, started.bindSessionId, {
      v: 1,
      operationId: 'op-late',
      strategy: 'initialize_cloud',
      localNodes: [],
      expected: { cloudSeq: 0, syncEpoch: 1, localRevision: 0 },
    })).rejects.toMatchObject({ statusCode: 409 })
  })
})
