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

const nodeInput = (id: string) => ({
  id,
  type: 'bookmark' as const,
  parentId: null,
  title: id,
  url: 'https://example.com',
  createdAt: now(),
  updatedAt: now(),
})

describe('security boundaries', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>
  let config: ReturnType<typeof testConfig>
  let boot: Awaited<ReturnType<typeof bootstrapAdmin>>
  let keyService: KeyService
  let sessionService: SessionService
  let bindService: BindService
  let operationService: OperationService

  beforeEach(async () => {
    pool = await createPgMemPool()
    config = testConfig()
    boot = await bootstrapAdmin(pool, config)
    sessionService = new SessionService(pool, config)
    keyService = new KeyService(pool, config)
    bindService = new BindService(pool, config, sessionService)
    operationService = new OperationService(pool, config.maxNodesPerImport)
  })

  const build = async () => buildApp({
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
    realtime: new RealtimeHub(),
  })

  const bindDevice = async (srkey: string) => {
    const started = await bindService.start({ v: 1, srkey, deviceName: 'device' })
    const cloud = await bindService.cloudSnapshot(started.bindToken, started.bindSessionId)
    await bindService.backupProof(started.bindToken, started.bindSessionId, {
      cloudDigest: cloud.digest,
      localDigest: 'a'.repeat(64),
      localRevision: 0,
      downloadState: 'complete',
      downloadedAt: now(),
    })
    const completed = await bindService.complete(started.bindToken, started.bindSessionId, {
      v: 1,
      operationId: `op-sec-${started.bindSessionId}`,
      strategy: 'initialize_cloud',
      localNodes: [nodeInput('seed')],
      expected: { cloudSeq: started.cloud.cloudSeq, syncEpoch: started.cloud.syncEpoch, localRevision: 0 },
    })
    return completed.deviceSession
  }

  it('rejects requests with revoked device sessions', async () => {
    const session = await bindDevice(boot.generatedSrkey!)
    const ctx = (await sessionService.authenticateAccess(session.accessToken))!
    await sessionService.revoke(ctx.sessionId)
    const app = await build()
    const pull = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull?after=0',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(pull.statusCode).toBe(401)
  })

  it('invalidates every existing session when a Key is rotated', async () => {
    const session = await bindDevice(boot.generatedSrkey!)
    const adminKey = (await keyService.listForAdmin('admin')).find((key) => key.role === 'admin')!
    await keyService.rotateKey('admin', adminKey.keyId)
    const app = await build()
    const push = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { v: 1, ops: [] },
    })
    expect(push.statusCode).toBe(401)
  })

  it('rejects backup proofs whose cloud digest does not match the locked snapshot', async () => {
    const started = await bindService.start({ v: 1, srkey: boot.generatedSrkey!, deviceName: 'device' })
    await expect(bindService.backupProof(started.bindToken, started.bindSessionId, {
      cloudDigest: 'f'.repeat(64),
      localDigest: 'a'.repeat(64),
      localRevision: 0,
      downloadState: 'complete',
      downloadedAt: now(),
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('never lets a normal Key call administrator APIs', async () => {
    const created = await keyService.createKey('admin', 'normal key')
    const session = await bindDevice(created.srkey)
    const app = await build()
    const list = await app.inject({
      method: 'GET',
      url: '/v1/admin/keys',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(list.statusCode).toBe(403)
    const create = await app.inject({
      method: 'POST',
      url: '/v1/admin/keys',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { v: 1 },
    })
    expect(create.statusCode).toBe(403)
  })

  it('ignores foreign namespace ids in pull queries', async () => {
    const session = await bindDevice(boot.generatedSrkey!)
    const app = await build()
    const pull = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull?after=0&namespaceId=someone-elses',
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    expect(pull.statusCode).toBe(200)
    const ids = (pull.json().events as Array<{ payload: { node?: { id: string }; nodes?: Array<{ id: string }> } }>)
      .flatMap((event) => event.payload.node ? [event.payload.node.id] : (event.payload.nodes?.map((n) => n.id) ?? []))
    expect(ids).toEqual(['seed'])
  })
})
