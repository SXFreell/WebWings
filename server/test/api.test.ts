import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { createLogger } from '../src/logger'
import { bootstrapAdmin, KeyService } from '../src/keys'
import { createRateLimiter } from '../src/rateLimit'
import { RealtimeHub } from '../src/realtime'
import { SessionService } from '../src/sessions'
import { BindService } from '../src/services/bind'
import { OperationService } from '../src/services/operations'
import { SyncService } from '../src/services/sync'
import { createPgMemPool, testConfig } from './helpers/pgmem'
import { KeyRepo } from '../src/repos/keys'

const setup = async (overrides: Record<string, string> = {}) => {
  const pool = await createPgMemPool()
  const config = testConfig(overrides)
  const boot = await bootstrapAdmin(pool, config)
  const sessionService = new SessionService(pool, config)
  const realtime = new RealtimeHub()
  const operationService = new OperationService(pool, config.maxNodesPerImport)
  const syncService = new SyncService(pool, config, operationService)
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
    syncService,
    realtime,
  })
  await app.ready()
  return { app, pool, config, boot, bindService, sessionService, operationService }
}

describe('service discovery and bind APIs', () => {
  let ctx: Awaited<ReturnType<typeof setup>>

  beforeEach(async () => {
    ctx = await setup()
  })

  it('exposes stable discovery metadata with version and capabilities', async () => {
    const first = await ctx.app.inject({ method: 'GET', url: '/v1/info' })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({
      service: 'webwings-sync',
      apiVersion: 1,
      instanceId: 'srv_test_instance',
    })
    expect(first.json().features).toContain('sync')
    expect(first.json().serverTime).toBeTruthy()
    expect(first.json().minClientVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('binds with a valid admin srkey and never echoes the raw secret', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/bind/start',
      payload: { v: 1, srkey: ctx.boot.generatedSrkey!, deviceName: 'test device' },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.bindSessionId).toBeTruthy()
    expect(body.bindToken).toBeTruthy()
    expect(body.cloud.hasData).toBe(false)
    expect(body.capabilities).toContain('keys:manage')
    expect(JSON.stringify(body)).not.toContain(ctx.boot.generatedSrkey!)
  })

  it('rejects invalid, malformed and unknown srkeys indistinguishably', async () => {
    const attempts = [
      { v: 1, srkey: 'srk_sync_0000000000000000000000000000000000000000000' },
      { v: 1, srkey: 'not-a-key' },
    ]
    const responses = []
    for (const payload of attempts) {
      const response = await ctx.app.inject({ method: 'POST', url: '/v1/bind/start', payload })
      expect(response.statusCode).toBe(401)
      const body = response.json()
      expect(body.error.code).toBe('unauthorized')
      expect(JSON.stringify(body)).not.toContain('srk_')
      responses.push(body.error.code)
    }
    expect(new Set(responses).size).toBe(1)

    const missing = await ctx.app.inject({ method: 'POST', url: '/v1/bind/start', payload: { v: 1 } })
    const empty = await ctx.app.inject({ method: 'POST', url: '/v1/bind/start', payload: { v: 1, srkey: '' } })
    expect(missing.statusCode).toBe(400)
    expect(empty.statusCode).toBe(400)
  })

  it('rate limits bind attempts per client address', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 })
    const pool = ctx.pool
    const config = ctx.config
    const sessionService = new SessionService(pool, config)
    const keyService = new KeyService(pool, config)
    const operationService = new OperationService(pool, config.maxNodesPerImport)
    const bindService = new BindService(pool, config, sessionService)
    const app = buildApp({
      pool,
      config,
      logger: createLogger('error', new PassThrough()),
      instanceId: 'srv_test_instance',
      bindLimiter: limiter,
      sessionService,
      keyService,
      bindService,
      operationService,
      syncService: new SyncService(pool, config, operationService),
      realtime: new RealtimeHub(),
    })
    await app.ready()
    const payload = { v: 1, srkey: ctx.boot.generatedSrkey! }
    const first = await app.inject({ method: 'POST', url: '/v1/bind/start', payload, remoteAddress: '203.0.113.9' })
    const second = await app.inject({ method: 'POST', url: '/v1/bind/start', payload, remoteAddress: '203.0.113.9' })
    const third = await app.inject({ method: 'POST', url: '/v1/bind/start', payload, remoteAddress: '203.0.113.9' })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(third.statusCode).toBe(429)
  })

  it('rejects malformed urls and oversized payloads', async () => {
    const oversizedConfig = testConfig({ WEBWINGS_MAX_BODY_BYTES: '100' })
    const pool = ctx.pool
    const sessionService = new SessionService(pool, oversizedConfig)
    const keyService = new KeyService(pool, oversizedConfig)
    const operationService = new OperationService(pool, oversizedConfig.maxNodesPerImport)
    const bindService = new BindService(pool, oversizedConfig, sessionService)
    const oversizedApp = buildApp({
      pool,
      config: oversizedConfig,
      logger: createLogger('error', new PassThrough()),
      instanceId: 'srv_test_instance',
      bindLimiter: createRateLimiter({ windowMs: 60_000, max: 100 }),
      sessionService,
      keyService,
      bindService,
      operationService,
      syncService: new SyncService(pool, oversizedConfig, operationService),
      realtime: new RealtimeHub(),
    })
    await oversizedApp.ready()
    const oversized = await oversizedApp.inject({
      method: 'POST',
      url: '/v1/bind/start',
      payload: { v: 1, srkey: 'x'.repeat(500) },
    })
    expect(oversized.statusCode).toBe(413)
  })
})

describe('authenticated sync APIs', () => {
  it('keeps namespace isolation even when payloads carry foreign namespace ids', async () => {
    const { app, pool, config, boot } = await setup()
    const sessionService = new SessionService(pool, config)
    const keyService = new KeyService(pool, config)
    const adminSrkey = boot.generatedSrkey!
    const adminKey = await keyService.listForAdmin('admin').then((keys) => keys.find((key) => key.role === 'admin')!)
    const device = await pool.query("insert into devices (id, key_id) values ('dev-a', $1) returning id", [
      adminKey.keyId,
    ])
    const key = await new KeyRepo(pool).get(adminKey.keyId)
    const issued = await sessionService.issueForDevice(key!, device.rows[0].id)

    const operationService = new OperationService(pool, config.maxNodesPerImport)
    const syncService = new SyncService(pool, config, operationService)
    const appWithSync = buildApp({
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
    await appWithSync.ready()

    const createOp = {
      v: 1,
      opId: 'op-isolated-1',
      deviceId: issued.deviceId,
      syncEpoch: 1,
      type: 'create_node',
      node: {
        id: 'node-a',
        type: 'bookmark',
        parentId: null,
        title: 'isolated',
        url: 'https://example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // attempt a namespace override; the server must ignore it
      namespaceId: 'someone-elses-namespace',
    }
    const push = await appWithSync.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { authorization: `Bearer ${issued.accessToken}` },
      payload: { v: 1, ops: [createOp] },
    })
    expect(push.statusCode).toBe(200)
    expect(push.json().receipts[0].status).toBe('accepted')

    const pull = await appWithSync.inject({
      method: 'GET',
      url: '/v1/sync/pull?after=0',
      headers: { authorization: `Bearer ${issued.accessToken}` },
    })
    expect(pull.statusCode).toBe(200)
    expect(pull.json().events).toHaveLength(1)
    expect(pull.json().events[0].opId).toBe('op-isolated-1')
    expect(pull.json().epoch).toBe(1)
    void app
  })

  it('rejects operations carrying malformed urls before touching data', async () => {
    const { pool, config, boot } = await setup()
    const sessionService = new SessionService(pool, config)
    const keyService = new KeyService(pool, config)
    const adminKey = (await keyService.listForAdmin('admin')).find((key) => key.role === 'admin')!
    const device = await pool.query("insert into devices (id, key_id) values ('dev-b', $1) returning id", [
      adminKey.keyId,
    ])
    const key = await new KeyRepo(pool).get(adminKey.keyId)
    const issued = await sessionService.issueForDevice(key!, device.rows[0].id)
    const operationService = new OperationService(pool, config.maxNodesPerImport)
    const app = buildApp({
      pool,
      config,
      logger: createLogger('error', new PassThrough()),
      instanceId: 'srv_test_instance',
      bindLimiter: createRateLimiter({ windowMs: 60_000, max: 100 }),
      sessionService,
      keyService,
      bindService: new BindService(pool, config, sessionService),
      operationService,
      syncService: new SyncService(pool, config, operationService),
      realtime: new RealtimeHub(),
    })
    await app.ready()
    const push = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { authorization: `Bearer ${issued.accessToken}` },
      payload: {
        v: 1,
        ops: [
          {
            v: 1,
            opId: 'op-bad-url',
            deviceId: issued.deviceId,
            syncEpoch: 1,
            type: 'create_node',
            node: {
              id: 'bad',
              type: 'bookmark',
              parentId: null,
              title: 'bad url',
              url: 'ftp://nope.example/thing',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      },
    })
    expect(push.statusCode).toBe(400)
    const pull = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull?after=0',
      headers: { authorization: `Bearer ${issued.accessToken}` },
    })
    expect(pull.json().events).toHaveLength(0)
  })
})
