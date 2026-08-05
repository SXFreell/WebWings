import type { SyncEventType } from '@webwings/sync-protocol'
import type { Queryable } from '../db'
import type { OperationReceiptRow, SyncEventRow } from './types'

const EVENT_COLUMNS = `namespace_id as "namespaceId", sync_epoch as "syncEpoch", seq, op_id as "opId",
  device_id as "deviceId", event_type as "eventType", payload, created_at as "createdAt"`

export class EventRepo {
  constructor(private readonly db: Queryable) {}

  async append(
    namespaceId: string,
    syncEpoch: number,
    seq: number,
    opId: string,
    deviceId: string | null,
    eventType: SyncEventType,
    payload: unknown,
  ): Promise<void> {
    await this.db.query(
      `insert into sync_events (namespace_id, sync_epoch, seq, op_id, device_id, event_type, payload)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [namespaceId, syncEpoch, seq, opId, deviceId, eventType, JSON.stringify(payload)],
    )
  }

  async listAfter(namespaceId: string, afterSeq: number, limit: number): Promise<SyncEventRow[]> {
    const result = await this.db.query<SyncEventRow>(
      `select ${EVENT_COLUMNS} from sync_events
       where namespace_id = $1 and seq > $2
       order by seq
       limit $3`,
      [namespaceId, afterSeq, limit],
    )
    return result.rows
  }

  async earliestSeq(namespaceId: string): Promise<number | null> {
    const result = await this.db.query<{ min: string | null }>(
      'select min(seq)::text as min from sync_events where namespace_id = $1',
      [namespaceId],
    )
    const value = result.rows[0]?.min
    return value === null || value === undefined ? null : Number(value)
  }

  async deleteBefore(namespaceId: string, seq: number): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      'delete from sync_events where namespace_id = $1 and seq < $2 returning seq',
      [namespaceId, seq],
    )
    return result.rowCount ?? 0
  }

  async purgeNamespace(namespaceId: string): Promise<void> {
    await this.db.query('delete from sync_events where namespace_id = $1', [namespaceId])
  }
}

export class ReceiptRepo {
  constructor(private readonly db: Queryable) {}

  async get(namespaceId: string, opId: string): Promise<OperationReceiptRow | null> {
    const result = await this.db.query<OperationReceiptRow>(
      `select namespace_id as "namespaceId", op_id as "opId", seq, status,
              error_code as "errorCode", payload, created_at as "createdAt"
       from operation_receipts where namespace_id = $1 and op_id = $2`,
      [namespaceId, opId],
    )
    return result.rows[0] ?? null
  }

  async insert(
    namespaceId: string,
    opId: string,
    seq: number | null,
    status: OperationReceiptRow['status'],
    errorCode: string | null,
    payload: unknown,
  ): Promise<void> {
    await this.db.query(
      `insert into operation_receipts (namespace_id, op_id, seq, status, error_code, payload)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (namespace_id, op_id) do nothing`,
      [namespaceId, opId, seq, status, errorCode, JSON.stringify(payload ?? null)],
    )
  }

  async purgeNamespace(namespaceId: string): Promise<void> {
    await this.db.query('delete from operation_receipts where namespace_id = $1', [namespaceId])
  }
}
