import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { createLogger } from '../src/logger'
import { bootstrapAdmin, KeyService } from '../src/keys'
import { createRateLimiter } from '../src/rateLimit'
import { RealtimeHub } from '../src/realtime'
import { DeviceRepo } from '../src/repos/devices'
import { EventRepo } from '../src/repos/events'
import { KeyRepo } from '../src/repos/keys'
import { SessionService } from '../src/sessions'
import { BindService } from '../src/services/bind'
import { OperationService } from '../src/services/operations'
import { SyncService } from '../src/services/sync'
import { createPgMemPool, testConfig } from './helpers/pgmem'

const now = () => new Date().toISOString()

describe('sync pull, snapshot and retention', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>
  let config: ReturnType<typeof testConfig>
  let app: ReturnType<typeof buildApp>
  let accessToken: string
  let namespaceId: string
  let operationService: OperationService

  beforeEach(async () => {
    pool = await createPgMemPool()
    config = testConfig()
    const boot = await bootstrapAdmin(pool, config)
    const keyService = new KeyService(pool, config)
    const adminKey = (await keyService.listForAdmin('admin')).find((key) => key.role === 'admin')!
    const key = await new KeyRepo(pool).get(adminKey.keyId)
    namespaceId = key!.namespaceId
    const device = await new DeviceRepo(pool).createDevice(key!.id, 'sync device', null)
    const sessionService = new SessionService(pool, config)
    const issued = await sessionService.issueForDevice(key!, device.id)
    accessToken = issued.accessToken
    operationService = new OperationService(pool, config.maxNodesPerImport)
    const syncService = new SyncService(pool, config, operationService)
    app = buildApp({
      pool,
      config,
      logger: createLogger('error', new PassThrough()),
      instanceId: 'srv_test_instance',
      bindLimiter: createRateLimiter({ windowMs: 60_000, max: 100 }),
      sessionService,
      keyService,
      bindService: new BindService(pool, config, sessionService),
      operationService,
      syncService,
      realtime: new RealtimeHub(),
    })
    await app.ready()
  })

  const auth = () => ({ authorization: `Bearer ${accessToken}` })

  const createNode = async (opId: string, id: string) => {
    await operationService.push(
      { sessionId: 's', deviceId: 'sync device', keyId: 'k', keyPrefix: 'p', namespaceId, role: 'sync' },
      [
        {
          v: 1,
          opId,
          deviceId: 'sync device',
          syncEpoch: 1,
          type: 'create_node',
          node: {
            id,
            type: 'bookmark',
            parentId: null,
            title: id,
            url: 'https://example.com',
            createdAt: now(),
            updatedAt: now(),
          },
        },
      ],
    )
  }

  it('pulls ordered events and returns the same result on cursor retry', async () => {
    await createNode('op-1', 'a')
    await createNode('op-2', 'b')
    const first = await app.inject({ method: 'GET', url: '/v1/sync/pull?after=0', headers: auth() })
    const retry = await app.inject({ method: 'GET', url: '/v1/sync/pull?after=0', headers: auth() })
    expect(first.statusCode).toBe(200)
    expect(first.json().events.map((event: { opId: string }) => event.opId)).toEqual(['op-1', 'op-2'])
    expect(retry.json()).toEqual(first.json())

    const head = await app.inject({ method: 'GET', url: '/v1/sync/pull?after=2', headers: auth() })
    expect(head.json().events).toEqual([])
    expect(head.json().status).toBe('ok')
  })

  it('requests a snapshot for stale epochs and expired cursors', async () => {
    await createNode('op-1', 'a')
    const wrongEpoch = await app.inject({ method: 'GET', url: '/v1/sync/pull?after=0&epoch=99', headers: auth() })
    expect(wrongEpoch.json().status).toBe('snapshot_required')

    await new EventRepo(pool).deleteBefore(namespaceId, 999)
    const stale = await app.inject({ method: 'GET', url: '/v1/sync/pull?after=0', headers: auth() })
    expect(stale.json().status).toBe('snapshot_required')
    expect(stale.json().snapshotSeq).toBe(0)
  })

  it('serves and builds canonical snapshots with digests', async () => {
    await createNode('op-1', 'a')
    const snapshot = await app.inject({ method: 'GET', url: '/v1/sync/snapshot', headers: auth() })
    expect(snapshot.statusCode).toBe(200)
    const body = snapshot.json()
    expect(body.v).toBe(1)
    expect(body.epoch).toBe(1)
    expect(body.seq).toBe(1)
    expect(body.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(body.nodes).toHaveLength(1)
    expect(body.nodes[0].id).toBe('a')
  })

  it('pushes idempotently and returns original receipts on retry', async () => {
    const ctx = { sessionId: 's', deviceId: 'sync device', keyId: 'k', keyPrefix: 'p', namespaceId, role: 'sync' as const }
    const op = {
      v: 1 as const,
      opId: 'op-dup',
      deviceId: 'sync device',
      syncEpoch: 1,
      type: 'create_node' as const,
      node: {
        id: 'dup',
        type: 'bookmark' as const,
        parentId: null,
        title: 'dup',
        url: 'https://example.com',
        createdAt: now(),
        updatedAt: now(),
      },
    }
    const first = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: auth(),
      payload: { v: 1, ops: [op] },
    })
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: auth(),
      payload: { v: 1, ops: [op] },
    })
    expect(first.json().receipts).toEqual(retry.json().receipts)
    void ctx
  })
})
