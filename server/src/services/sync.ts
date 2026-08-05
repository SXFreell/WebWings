import type pg from 'pg'
import type { PullResponse, SnapshotPayload, SyncEvent } from '@webwings/sync-protocol'
import type { ServerConfig } from '../config'
import { withTransaction } from '../db'
import { notFound } from '../errors'
import { EventRepo } from '../repos/events'
import { NamespaceRepo } from '../repos/namespaces'
import { SnapshotRepo } from '../repos/snapshots'
import type { AuthContext } from '../sessions'
import { OperationService } from './operations'
import { SnapshotService } from './snapshots'

export interface PullArgs {
  after: number
  limit: number
  epoch?: number
}

const eventToProtocol = (row: {
  syncEpoch: number
  seq: number
  opId: string
  deviceId: string | null
  eventType: string
  payload: unknown
  createdAt: string
}): SyncEvent => ({
  syncEpoch: row.syncEpoch,
  seq: row.seq,
  opId: row.opId,
  deviceId: row.deviceId ?? '',
  type: row.eventType as SyncEvent['type'],
  payload: row.payload,
  createdAt: row.createdAt,
})

export class SyncService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: ServerConfig,
    private readonly operations: OperationService,
  ) {}

  push = (ctx: AuthContext, ops: Parameters<OperationService['push']>[1]) => this.operations.push(ctx, ops)

  async pull(ctx: AuthContext, args: PullArgs): Promise<PullResponse> {
    const namespaces = new NamespaceRepo(this.pool)
    const ns = await namespaces.get(ctx.namespaceId)
    if (!ns) throw notFound('namespace not found')
    const eventsRepo = new EventRepo(this.pool)

    if (args.epoch !== undefined && args.epoch !== ns.syncEpoch) {
      return this.snapshotRequired(ctx.namespaceId, ns.syncEpoch, ns.currentSeq)
    }
    if (args.after < 0 || args.limit < 1) throw notFound('invalid cursor')

    const earliest = await eventsRepo.earliestSeq(ctx.namespaceId)
    const staleCursor = earliest === null ? args.after < ns.currentSeq : args.after < earliest - 1
    if (staleCursor && args.after < ns.currentSeq) {
      return this.snapshotRequired(ctx.namespaceId, ns.syncEpoch, ns.currentSeq)
    }

    const rows = await eventsRepo.listAfter(ctx.namespaceId, args.after, args.limit)
    return {
      v: 1,
      status: 'ok',
      epoch: ns.syncEpoch,
      currentSeq: ns.currentSeq,
      events: rows.map(eventToProtocol),
    }
  }

  private async snapshotRequired(namespaceId: string, epoch: number, currentSeq: number): Promise<PullResponse> {
    const latest = await new SnapshotRepo(this.pool).latest(namespaceId)
    return {
      v: 1,
      status: 'snapshot_required',
      epoch,
      currentSeq,
      snapshotSeq: latest?.seq ?? 0,
    }
  }

  async snapshot(ctx: AuthContext): Promise<SnapshotPayload> {
    const namespaces = new NamespaceRepo(this.pool)
    const ns = await namespaces.get(ctx.namespaceId)
    if (!ns) throw notFound('namespace not found')
    const repo = new SnapshotRepo(this.pool)
    const latest = await repo.latest(ctx.namespaceId)
    if (latest && latest.syncEpoch === ns.syncEpoch && latest.seq >= ns.currentSeq) {
      return latest.payload as SnapshotPayload
    }
    const payload = await withTransaction(this.pool, async (client) => {
      const { payload: built } = await new SnapshotService().buildAndStore(client, ctx.namespaceId, ns.syncEpoch, ns.currentSeq)
      return built as SnapshotPayload
    })
    void this.config
    return payload
  }
}
