import type { Queryable } from '../db'
import type { NamespaceRow } from './types'

const COLUMNS = `id, sync_epoch as "syncEpoch", current_seq as "currentSeq",
  initialized_at as "initializedAt", created_at as "createdAt"`

type RawNamespaceRow = Omit<NamespaceRow, 'currentSeq'> & { currentSeq: number | string }

/**
 * Postgres returns `bigint` columns as strings; protocol fields must be JSON
 * numbers, so coerce the namespace sequence at the repo boundary.
 */
export const toNamespaceRow = (row: RawNamespaceRow): NamespaceRow => ({
  ...row,
  currentSeq: Number(row.currentSeq),
})

export class NamespaceRepo {
  constructor(private readonly db: Queryable) {}

  async create(id: string): Promise<void> {
    await this.db.query('insert into namespaces (id) values ($1)', [id])
  }

  async get(id: string): Promise<NamespaceRow | null> {
    const result = await this.db.query<NamespaceRow>(`select ${COLUMNS} from namespaces where id = $1`, [id])
    return result.rows[0] ? toNamespaceRow(result.rows[0]) : null
  }

  /** Locks the namespace row for the remainder of the enclosing transaction. */
  async lock(id: string): Promise<NamespaceRow | null> {
    const result = await this.db.query<NamespaceRow>(
      `select ${COLUMNS} from namespaces where id = $1 for update`,
      [id],
    )
    return result.rows[0] ? toNamespaceRow(result.rows[0]) : null
  }

  /**
   * Allocates the next monotonically increasing sequence for a namespace.
   * Must be called inside a transaction; the namespace row is locked first.
   */
  async allocateSeq(id: string): Promise<number> {
    await this.lock(id)
    const result = await this.db.query<{ current_seq: string }>(
      'update namespaces set current_seq = current_seq + 1 where id = $1 returning current_seq',
      [id],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`namespace not found: ${id}`)
    return Number(row.current_seq)
  }

  async setEpoch(id: string, syncEpoch: number, currentSeq: number): Promise<void> {
    await this.db.query(
      'update namespaces set sync_epoch = $2, current_seq = $3 where id = $1',
      [id, syncEpoch, currentSeq],
    )
  }

  async markInitialized(id: string): Promise<void> {
    await this.db.query(
      "update namespaces set initialized_at = coalesce(initialized_at, now()) where id = $1",
      [id],
    )
  }

  async bumpEpoch(id: string): Promise<number> {
    const result = await this.db.query<{ sync_epoch: number }>(
      'update namespaces set sync_epoch = sync_epoch + 1 where id = $1 returning sync_epoch',
      [id],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`namespace not found: ${id}`)
    return row.sync_epoch
  }

  async listPendingDeletion(): Promise<NamespaceRow[]> {
    const result = await this.db.query<NamespaceRow>(
      `select n.id, n.sync_epoch as "syncEpoch", n.current_seq as "currentSeq",
              n.initialized_at as "initializedAt", n.created_at as "createdAt"
       from namespaces n
       join access_keys k on k.namespace_id = n.id
       where k.status = 'pending_delete' and k.purge_at is not null`,
    )
    return result.rows.map(toNamespaceRow)
  }
}
