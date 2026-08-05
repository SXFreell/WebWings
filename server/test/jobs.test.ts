import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../src/logger'
import { bootstrapAdmin, KeyService } from '../src/keys'
import { SyncJobs } from '../src/jobs'
import { KeyRepo } from '../src/repos/keys'
import { NamespaceRepo } from '../src/repos/namespaces'
import { EventRepo } from '../src/repos/events'
import { SnapshotRepo } from '../src/repos/snapshots'
import { NodeRepo } from '../src/repos/nodes'
import { DeviceRepo } from '../src/repos/devices'
import { SnapshotService } from '../src/services/snapshots'
import { OperationService } from '../src/services/operations'
import { SessionService } from '../src/sessions'
import { createPgMemPool, testConfig } from './helpers/pgmem'
import type { SyncOperation } from '@webwings/sync-protocol'

const now = () => new Date().toISOString()

const nodeInput = (id: string) => ({
  id,
  type: 'bookmark' as const,
  parentId: null,
  title: id,
  url: 'https://example.com',
  createdAt: now(),
  updatedAt: now(),
})

const op = (opId: string, type: SyncOperation['type'], body: Record<string, unknown>): SyncOperation =>
  ({ v: 1, opId, deviceId: 'dev-1', syncEpoch: 1, type, ...body }) as SyncOperation

describe('scheduled jobs', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>
  let config: ReturnType<typeof testConfig>

  beforeEach(async () => {
    pool = await createPgMemPool()
    config = testConfig()
    await bootstrapAdmin(pool, config)
  })

  const noopLock = async () => {}

  it('creates snapshots at the configured interval', async () => {
    const namespaces = new NamespaceRepo(pool)
    const namespaceId = (await new KeyRepo(pool).list())[0].namespaceId
    for (let i = 1; i <= 3; i += 1) await namespaces.allocateSeq(namespaceId)
    const jobs = new SyncJobs(pool, { ...config, snapshotIntervalEvents: 2 }, createLogger('error', new PassThrough()), noopLock)
    await jobs.run()
    const snapshot = await new SnapshotRepo(pool).latest(namespaceId)
    expect(snapshot?.seq).toBe(3)
  })

  it('prunes events only after a usable snapshot exists', async () => {
    const namespaceId = (await new KeyRepo(pool).list())[0].namespaceId
    const namespaces = new NamespaceRepo(pool)
    const events = new EventRepo(pool)
    for (let i = 1; i <= 4; i += 1) {
      const seq = await namespaces.allocateSeq(namespaceId)
      await events.append(namespaceId, 1, seq, `op-${i}`, 'dev', 'created', { i })
    }
    await new SnapshotService().buildAndStore(pool, namespaceId, 1, 2)

    const jobs = new SyncJobs(pool, config, createLogger('error', new PassThrough()), noopLock)
    const result = await jobs.run()
    expect(result.eventsPruned).toBe(1)
    expect((await events.listAfter(namespaceId, 0, 10)).map((event) => event.seq)).toEqual([2, 3, 4])
  })

  it('purges expired pending-delete namespaces and keeps active ones', async () => {
    const keyService = new KeyService(pool, config)
    const created = await keyService.createKey('admin', 'to purge')
    await new KeyRepo(pool).markPendingDelete(created.keyId, '2000-01-01T00:00:00Z')
    const active = await keyService.createKey('admin', 'keep me')
    const createdRow = await new KeyRepo(pool).get(created.keyId)

    const jobs = new SyncJobs(pool, config, createLogger('error', new PassThrough()), noopLock)
    const result = await jobs.run()
    expect(result.namespacesPurged).toHaveLength(1)
    expect(await new KeyRepo(pool).get(created.keyId)).toBeNull()
    expect(await new NamespaceRepo(pool).get(createdRow!.namespaceId)).toBeNull()
    expect((await new KeyRepo(pool).get(active.keyId))?.status).toBe('active')
    void active
  })

  it('expires tombstones after the retention window and keeps recent ones', async () => {
    const key = (await new KeyRepo(pool).list())[0]
    const sessionService = new SessionService(pool, config)
    const device = await new DeviceRepo(pool).createDevice(key.id, 'tombstone device', null)
    const issued = await sessionService.issueForDevice(key, device.id)
    const ctx = (await sessionService.authenticateAccess(issued.accessToken))!
    const ops = new OperationService(pool, config.maxNodesPerImport)

    await ops.push(ctx, [op('op-old', 'create_node', { node: nodeInput('old') })])
    await ops.push(ctx, [op('op-recent', 'create_node', { node: nodeInput('recent') })])
    await ops.push(ctx, [op('op-del-old', 'delete_tree', { nodeId: 'old' })])
    await ops.push(ctx, [op('op-del-recent', 'delete_tree', { nodeId: 'recent' })])

    await pool.query('update bookmark_nodes set deleted_at = $1 where namespace_id = $2 and id = $3', [
      new Date(Date.now() - config.deleteRetentionDays * 86_400_000 - 60_000).toISOString(),
      key.namespaceId,
      'old',
    ])

    const jobs = new SyncJobs(pool, config, createLogger('error', new PassThrough()), noopLock)
    const result = await jobs.run()
    expect(result.tombstonesExpired).toBe(1)
    expect(await new NodeRepo(pool).get(key.namespaceId, 'old')).toBeNull()
    expect((await new NodeRepo(pool).get(key.namespaceId, 'recent'))?.deletedAt).toBeTruthy()
  })

  it('expires stale bind sessions', async () => {
    const keyId = (await new KeyRepo(pool).list())[0].id
    const device = await new DeviceRepo(pool).createDevice(keyId, 'bind device', null)
    await pool.query(
      `insert into bind_sessions
        (id, key_id, device_id, bind_token_hash, sync_epoch, cloud_seq, cloud_has_data, expires_at)
       values ('b1', $1, $2, 'hash', 1, 0, false, now() - interval '1 hour')`,
      [keyId, device.id],
    )
    const jobs = new SyncJobs(pool, config, createLogger('error', new PassThrough()), noopLock)
    const result = await jobs.run()
    expect(result.bindSessionsExpired).toBe(1)
  })
})
