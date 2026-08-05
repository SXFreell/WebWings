import type { Queryable } from '../db'
import type { BindSessionRow } from './types'

const COLUMNS = `id, key_id as "keyId", device_id as "deviceId", bind_token_hash as "bindTokenHash",
  sync_epoch as "syncEpoch", cloud_seq as "cloudSeq", cloud_digest as "cloudDigest",
  cloud_has_data as "cloudHasData", cloud_snapshot as "cloudSnapshot", state,
  local_revision as "localRevision", local_digest as "localDigest", strategy,
  operation_id as "operationId", completed_epoch as "completedEpoch",
  completed_seq as "completedSeq", expires_at as "expiresAt", created_at as "createdAt"`

export interface CreateBindSessionInput {
  id: string
  keyId: string
  deviceId: string
  bindTokenHash: string
  syncEpoch: number
  cloudSeq: number
  cloudHasData: boolean
  cloudSnapshot: unknown
  expiresAt: string
}

export class BindSessionRepo {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateBindSessionInput): Promise<BindSessionRow> {
    const result = await this.db.query<BindSessionRow>(
      `insert into bind_sessions
        (id, key_id, device_id, bind_token_hash, sync_epoch, cloud_seq,
         cloud_has_data, cloud_snapshot, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning ${COLUMNS}`,
      [
        input.id,
        input.keyId,
        input.deviceId,
        input.bindTokenHash,
        input.syncEpoch,
        input.cloudSeq,
        input.cloudHasData,
        JSON.stringify(input.cloudSnapshot ?? null),
        input.expiresAt,
      ],
    )
    return result.rows[0]
  }

  async get(id: string): Promise<BindSessionRow | null> {
    const result = await this.db.query<BindSessionRow>(
      `select ${COLUMNS} from bind_sessions where id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  async getByTokenHash(hash: string): Promise<BindSessionRow | null> {
    const result = await this.db.query<BindSessionRow>(
      `select ${COLUMNS} from bind_sessions where bind_token_hash = $1`,
      [hash],
    )
    return result.rows[0] ?? null
  }

  async markExpired(): Promise<number> {
    const result = await this.db.query(
      `update bind_sessions
       set state = 'expired'
       where state in ('created', 'backup_proven') and expires_at < now()`,
    )
    return result.rowCount ?? 0
  }

  async markBackupProven(
    id: string,
    localRevision: number,
    localDigest: string,
    cloudDigest: string,
  ): Promise<void> {
    await this.db.query(
      `update bind_sessions
       set state = 'backup_proven', local_revision = $2, local_digest = $3, cloud_digest = $4
       where id = $1`,
      [id, localRevision, localDigest, cloudDigest],
    )
  }

  async markCompleted(id: string, strategy: string, operationId: string, epoch: number, seq: number): Promise<void> {
    await this.db.query(
      `update bind_sessions
       set state = 'completed', strategy = $2, operation_id = $3, completed_epoch = $4, completed_seq = $5
       where id = $1`,
      [id, strategy, operationId, epoch, seq],
    )
  }

  async delete(id: string): Promise<void> {
    await this.db.query('delete from bind_sessions where id = $1', [id])
  }
}
