import type pg from 'pg'
import type { ServerConfig } from './config'
import { withTransaction, type Queryable } from './db'
import type { Logger } from './logger'
import { BindSessionRepo } from './repos/bindSessions'
import { EventRepo, ReceiptRepo } from './repos/events'
import { KeyRepo } from './repos/keys'
import { NamespaceRepo } from './repos/namespaces'
import { NodeRepo } from './repos/nodes'
import { SnapshotRepo } from './repos/snapshots'
import { SnapshotService } from './services/snapshots'

const JOB_LOCK_KEY = 0x57454257 // "WEBW"

export interface SyncJobsResult {
  snapshotsCreated: number
  eventsPruned: number
  snapshotsPruned: number
  tombstonesExpired: number
  bindSessionsExpired: number
  namespacesPurged: string[]
}

/**
 * Scheduled maintenance jobs. Every run executes inside one transaction guarded
 * by a PostgreSQL advisory xact lock so multiple server processes never race.
 */
export class SyncJobs {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: ServerConfig,
    private readonly logger: Logger,
    private readonly acquireLock: (client: Queryable) => Promise<void> = async (client) => {
      await client.query('select pg_advisory_xact_lock($1)', [JOB_LOCK_KEY])
    },
  ) {}

  async run(): Promise<SyncJobsResult> {
    const result = await withTransaction(this.pool, async (client) => {
      await this.acquireLock(client)
      const namespaces = new NamespaceRepo(client)
      const snapshots = new SnapshotRepo(client)
      const events = new EventRepo(client)
      const snapshotService = new SnapshotService()
      let snapshotsCreated = 0
      let eventsPruned = 0
      let snapshotsPruned = 0
      let tombstonesExpired = 0

      const namespaceIds = (await client.query<{ id: string }>('select id from namespaces')).rows.map((row) => row.id)
      for (const namespaceId of namespaceIds) {
        const ns = await namespaces.lock(namespaceId)
        if (!ns) continue
        const latest = await snapshots.latest(namespaceId)
        const threshold = ns.currentSeq - this.config.snapshotIntervalEvents
        const snapshotStale = !latest || latest.syncEpoch !== ns.syncEpoch || latest.seq < ns.currentSeq
        if (snapshotStale && (!latest || latest.syncEpoch !== ns.syncEpoch || latest.seq <= threshold)) {
          await snapshotService.buildAndStore(client, namespaceId, ns.syncEpoch, ns.currentSeq)
          snapshotsCreated += 1
        }

        const usable = await snapshots.latest(namespaceId)
        if (usable && usable.syncEpoch === ns.syncEpoch) {
          eventsPruned += await events.deleteBefore(namespaceId, usable.seq)
          const before = await client.query<{ count: string }>(
            'select count(*)::text as count from snapshots where namespace_id = $1 and seq < $2',
            [namespaceId, usable.seq],
          )
          await snapshots.deleteBefore(namespaceId, usable.seq)
          snapshotsPruned += Number(before.rows[0]?.count ?? 0)
        }

        const cutoff = new Date(Date.now() - this.config.deleteRetentionDays * 86_400_000).toISOString()
        const expired = await client.query<{ count: string }>(
          `delete from bookmark_nodes
           where namespace_id = $1 and deleted_at is not null and deleted_at < $2
           returning id`,
          [namespaceId, cutoff],
        )
        tombstonesExpired += expired.rowCount ?? 0
      }

      const expiredBind = await new BindSessionRepo(client).markExpired()

      const pendingDeletion = await new KeyRepo(client).listExpiredPendingDeletion()
      const purged: string[] = []
      for (const key of pendingDeletion) {
        const nodes = new NodeRepo(client)
        await nodes.purgeNamespace(key.namespaceId)
        await events.purgeNamespace(key.namespaceId)
        await new ReceiptRepo(client).purgeNamespace(key.namespaceId)
        await snapshots.purgeNamespace(key.namespaceId)
        await client.query('delete from bind_sessions where key_id = $1', [key.id])
        await client.query('delete from devices where key_id = $1', [key.id])
        await client.query('delete from access_keys where id = $1', [key.id])
        await client.query('delete from namespaces where id = $1', [key.namespaceId])
        purged.push(key.namespaceId)
        this.logger.info('purged pending-delete namespace', { namespaceId: key.namespaceId, keyId: key.id })
      }

      return {
        snapshotsCreated,
        eventsPruned,
        snapshotsPruned,
        tombstonesExpired,
        bindSessionsExpired: expiredBind,
        namespacesPurged: purged,
      }
    })
    return result
  }
}
