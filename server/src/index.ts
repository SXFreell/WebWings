import type pg from 'pg'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildApp, type AppDeps } from './app'
import { loadConfig } from './config'
import { createLogger } from './logger'
import { createPool, migrate } from './db'
import { bootstrapAdmin, KeyService } from './keys'
import { createRateLimiter } from './rateLimit'
import { RealtimeHub } from './realtime'
import { SessionService } from './sessions'
import { BindService } from './services/bind'
import { OperationService } from './services/operations'
import { SyncService } from './services/sync'

const main = async () => {
  const config = loadConfig()
  const logger = createLogger(config.logLevel)
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required')
  const pool = createPool(config.databaseUrl)
  await migrate(pool, fileURLToPath(new URL('../migrations', import.meta.url)))

  const instance = await ensureInstanceId(pool, config)
  await bootstrapAdmin(pool, config)

  const realtime = new RealtimeHub()
  const sessionService = new SessionService(pool, config)
  const notify = (namespaceId: string, epoch: number, seq: number) => {
    realtime.notify(namespaceId, epoch, seq)
    void pool.query("select pg_notify('webwings_sync', $1)", [
      JSON.stringify({ namespaceId, epoch, seq }),
    ]).catch((error: unknown) => {
      logger.debug('pg_notify failed', { error: error instanceof Error ? error.message : String(error) })
    })
  }
  const operationService = new OperationService(pool, config.maxNodesPerImport, notify)
  const syncService = new SyncService(pool, config, operationService)
  const keyService = new KeyService(pool, config)
  const bindService = new BindService(pool, config, sessionService)
  const deps: AppDeps = {
    pool,
    config,
    logger,
    instanceId: instance,
    bindLimiter: createRateLimiter({ windowMs: 10 * 60_000, max: 20 }),
    sessionService,
    keyService,
    bindService,
    operationService,
    syncService,
    realtime,
  }
  const app = buildApp(deps)
  await app.listen({ port: config.port, host: '0.0.0.0' })
  logger.info(`webwings-sync listening on :${config.port}`, { instanceId: instance })
  setupPgListener(pool, realtime, logger)
}

const ensureInstanceId = async (pool: pg.Pool, config: ReturnType<typeof loadConfig>): Promise<string> => {
  const configured = config.instanceId
  const result = await pool.query<{ instance_id: string }>(
    `insert into server_settings (id, instance_id) values (1, $1)
     on conflict (id) do update set instance_id = server_settings.instance_id
     returning instance_id`,
    [configured ?? randomUUID()],
  )
  return result.rows[0].instance_id
}

const setupPgListener = (pool: pg.Pool, realtime: RealtimeHub, logger: ReturnType<typeof createLogger>) => {
  void pool.connect().then((client) => {
    void client.query('listen webwings_sync')
    client.on('notification', (message) => {
      try {
        const payload = JSON.parse(message.payload ?? '{}') as { namespaceId?: string; epoch?: number; seq?: number }
        if (payload.namespaceId && typeof payload.seq === 'number') {
          realtime.notify(payload.namespaceId, payload.epoch ?? 0, payload.seq)
        }
      } catch {
        logger.debug('ignored invalid sync notification')
      }
    })
  }).catch((error: unknown) => {
    logger.warn('realtime listener unavailable', { error: error instanceof Error ? error.message : String(error) })
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
