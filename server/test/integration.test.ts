import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { createLogger } from '../src/logger'
import { bootstrapAdmin, KeyService } from '../src/keys'
import { createRateLimiter } from '../src/rateLimit'
import { RealtimeHub } from '../src/realtime'
import { KeyRepo } from '../src/repos/keys'
import { SessionService } from '../src/sessions'
import { BindService } from '../src/services/bind'
import { OperationService } from '../src/services/operations'
import { SyncService } from '../src/services/sync'
import { createPgMemPool, testConfig } from './helpers/pgmem'

const now = () => new Date().toISOString()

const nodeInput = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: 'bookmark',
  parentId: null,
  title: id,
  url: 'https://example.com',
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
})

describe('cross-namespace integration', () => {
  let ctx: Awaited<ReturnType<typeof setup>>

  const setup = async () => {
    const pool = await createPgMemPool()
    const config = testConfig()
    const boot = await bootstrapAdmin(pool, config)
    const sessionService = new SessionService(pool, config)
    const realtime = new RealtimeHub()
    const operationService = new OperationService(pool, config.maxNodesPerImport, (namespaceId, epoch, seq) => realtime.notify(namespaceId, epoch, seq))
    const keyService = new KeyService(pool, config)
    const bindService = new BindService(pool, config, sessionService)
    const app = buildApp({
      pool,
      config,
      logger: createLogger('error', new PassThrough()),
      instanceId: 'srv_test_instance',
      bindLimiter: createRateLimiter({ windowMs: 60_000, max: 100 }),
      sessionService,
      keyService,
      bindService,
      operationService,
      syncService: new SyncService(pool, config, operationService),
      realtime,
    })
    await app.ready()
    return { app, pool, config, boot, sessionService, keyService, realtime }
  }

  beforeEach(async () => {
    ctx = await setup()
  })

  const bindOverHttp = async (srkey: string, localNodes: ReturnType<typeof nodeInput>[]) => {
    const started = await ctx.app.inject({ method: 'POST', url: '/v1/bind/start', payload: { v: 1, srkey } })
    expect(started.statusCode).toBe(200)
    const start = started.json()
    const snapshot = await ctx.app.inject({
      method: 'GET',
      url: `/v1/bind/${start.bindSessionId}/cloud-snapshot`,
      headers: { authorization: `Bearer ${start.bindToken}` },
    })
    expect(snapshot.statusCode).toBe(200)
    const cloud = snapshot.json()
    const proof = await ctx.app.inject({
      method: 'POST',
      url: `/v1/bind/${start.bindSessionId}/backup-proof`,
      headers: { authorization: `Bearer ${start.bindToken}` },
      payload: {
        v: 1,
        bindSessionId: start.bindSessionId,
        cloudDigest: cloud.digest,
        localDigest: 'a'.repeat(64),
        localRevision: localNodes.length,
        downloadState: 'complete',
        downloadedAt: now(),
      },
    })
    expect(proof.statusCode).toBe(200)
    const completed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/bind/${start.bindSessionId}/complete`,
      headers: { authorization: `Bearer ${start.bindToken}` },
      payload: {
        v: 1,
        operationId: `op-bind-${start.bindSessionId}`,
        strategy: 'initialize_cloud',
        localNodes,
        expected: { cloudSeq: start.cloud.cloudSeq, syncEpoch: start.cloud.syncEpoch, localRevision: localNodes.length },
      },
    })
    expect(completed.statusCode).toBe(200)
    return { start, device: completed.json().deviceSession }
  }

  it('keeps bind sessions, events, snapshots and admin metadata isolated per namespace over HTTP', async () => {
    const adminSrkey = ctx.boot.generatedSrkey!
    const adminBind = await bindOverHttp(adminSrkey, [nodeInput('admin-a')])
    const adminToken = adminBind.device.accessToken

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/keys',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { v: 1, label: 'user-b' },
    })
    expect(created.statusCode).toBe(200)
    const keyB = created.json()

    const bindB = await bindOverHttp(keyB.srkey, [nodeInput('b-1')])
    const tokenB = bindB.device.accessToken

    const pushA = await ctx.app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        v: 1,
        ops: [{ v: 1, opId: 'op-admin-b', deviceId: adminBind.device.deviceId, syncEpoch: 1, type: 'create_node', node: nodeInput('admin-b') }],
      },
    })
    expect(pushA.statusCode).toBe(200)

    const pullA = await ctx.app.inject({ method: 'GET', url: '/v1/sync/pull?after=0&limit=100', headers: { authorization: `Bearer ${adminToken}` } })
    expect(pullA.statusCode).toBe(200)
    const aEvents = pullA.json().events as Array<{ payload: { node?: { id: string }; nodes?: Array<{ id: string }> } }>
    const aIds = aEvents.flatMap((event) => event.payload.node ? [event.payload.node.id] : (event.payload.nodes?.map((n) => n.id) ?? []))
    expect(aIds).toContain('admin-a')
    expect(aIds).toContain('admin-b')
    expect(aIds).not.toContain('b-1')

    const pullB = await ctx.app.inject({ method: 'GET', url: '/v1/sync/pull?after=0&limit=100', headers: { authorization: `Bearer ${tokenB}` } })
    expect(pullB.statusCode).toBe(200)
    const bEvents = pullB.json().events as Array<{ payload: { node?: { id: string }; nodes?: Array<{ id: string }> } }>
    const bIds = bEvents.flatMap((event) => event.payload.node ? [event.payload.node.id] : (event.payload.nodes?.map((n) => n.id) ?? []))
    expect(bIds).toEqual(['b-1'])
    expect(bIds).not.toContain('admin-a')

    const snapshotA = await ctx.app.inject({ method: 'GET', url: '/v1/sync/snapshot', headers: { authorization: `Bearer ${adminToken}` } })
    expect(snapshotA.json().nodes.map((n: { id: string }) => n.id).sort()).toEqual(['admin-a', 'admin-b'])
    const snapshotB = await ctx.app.inject({ method: 'GET', url: '/v1/sync/snapshot', headers: { authorization: `Bearer ${tokenB}` } })
    expect(snapshotB.json().nodes.map((n: { id: string }) => n.id)).toEqual(['b-1'])

    const list = await ctx.app.inject({ method: 'GET', url: '/v1/admin/keys', headers: { authorization: `Bearer ${adminToken}` } })
    expect(list.statusCode).toBe(200)
    const summaries = list.json() as Array<{ role: string; nodeCount: number; deviceCount: number }>
    const adminSummary = summaries.find((key) => key.role === 'admin')
    const bSummary = summaries.find((key) => key.role === 'sync')
    expect(adminSummary?.nodeCount).toBe(2)
    expect(bSummary?.nodeCount).toBe(1)
    expect(bSummary?.deviceCount).toBe(1)

    const adminRow = (await new KeyRepo(ctx.pool).list()).find((key) => key.role === 'admin')!
    const bRow = (await new KeyRepo(ctx.pool).list()).find((key) => key.keyPrefix === keyB.keyPrefix)!
    const makeSocket = () => {
      const sent: string[] = []
      return { readyState: 1, OPEN: 1, sent, send: (payload: string) => { sent.push(payload) }, close: () => {} }
    }
    const socketA = makeSocket()
    const socketB = makeSocket()
    ctx.realtime.register(adminRow.namespaceId, adminRow.id, socketA as never)
    ctx.realtime.register(bRow.namespaceId, bRow.id, socketB as never)
    ctx.realtime.notify(adminRow.namespaceId, 1, 3)
    expect(socketA.sent).toHaveLength(1)
    expect(socketB.sent).toHaveLength(0)
  })
})
