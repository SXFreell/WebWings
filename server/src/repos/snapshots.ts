import type { Queryable } from '../db'
import type { SnapshotRow } from './types'

const COLUMNS = `namespace_id as "namespaceId", sync_epoch as "syncEpoch", seq, digest, payload,
  created_at as "createdAt"`

export class SnapshotRepo {
  constructor(private readonly db: Queryable) {}

  async insert(namespaceId: string, syncEpoch: number, seq: number, digest: string, payload: unknown): Promise<void> {
    await this.db.query(
      `insert into snapshots (namespace_id, sync_epoch, seq, digest, payload)
       values ($1, $2, $3, $4, $5)`,
      [namespaceId, syncEpoch, seq, digest, JSON.stringify(payload)],
    )
  }

  async latest(namespaceId: string): Promise<SnapshotRow | null> {
    const result = await this.db.query<SnapshotRow>(
      `select ${COLUMNS} from snapshots
       where namespace_id = $1
       order by sync_epoch desc, seq desc
       limit 1`,
      [namespaceId],
    )
    return result.rows[0] ?? null
  }

  async latestAtOrBefore(namespaceId: string, seq: number): Promise<SnapshotRow | null> {
    const result = await this.db.query<SnapshotRow>(
      `select ${COLUMNS} from snapshots
       where namespace_id = $1 and seq <= $2
       order by sync_epoch desc, seq desc
       limit 1`,
      [namespaceId, seq],
    )
    return result.rows[0] ?? null
  }

  async deleteBefore(namespaceId: string, seq: number): Promise<void> {
    await this.db.query('delete from snapshots where namespace_id = $1 and seq < $2', [namespaceId, seq])
  }

  async purgeNamespace(namespaceId: string): Promise<void> {
    await this.db.query('delete from snapshots where namespace_id = $1', [namespaceId])
  }
}
