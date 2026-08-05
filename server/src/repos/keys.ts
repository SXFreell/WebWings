import type { KeyRole, KeyStatus } from '@webwings/sync-protocol'
import type { Queryable } from '../db'
import type { AccessKeyRow, AdminKeySummaryRow } from './types'

const COLUMNS = `id, namespace_id as "namespaceId", key_prefix as "keyPrefix", secret_hash as "secretHash",
  role, status, label, token_version as "tokenVersion", created_at as "createdAt",
  revoked_at as "revokedAt", purge_at as "purgeAt", last_used_at as "lastUsedAt"`

export interface CreateKeyInput {
  id: string
  namespaceId: string
  keyPrefix: string
  secretHash: string
  role: KeyRole
  label?: string | null
}

export class KeyRepo {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateKeyInput): Promise<AccessKeyRow> {
    const result = await this.db.query<AccessKeyRow>(
      `insert into access_keys (id, namespace_id, key_prefix, secret_hash, role, label)
       values ($1, $2, $3, $4, $5, $6)
       returning ${COLUMNS}`,
      [input.id, input.namespaceId, input.keyPrefix, input.secretHash, input.role, input.label ?? null],
    )
    return result.rows[0]
  }

  async get(id: string): Promise<AccessKeyRow | null> {
    const result = await this.db.query<AccessKeyRow>(`select ${COLUMNS} from access_keys where id = $1`, [id])
    return result.rows[0] ?? null
  }

  async findBySecretHash(secretHash: string): Promise<AccessKeyRow | null> {
    const result = await this.db.query<AccessKeyRow>(
      `select ${COLUMNS} from access_keys where secret_hash = $1`,
      [secretHash],
    )
    return result.rows[0] ?? null
  }

  async list(): Promise<AccessKeyRow[]> {
    const result = await this.db.query<AccessKeyRow>(`select ${COLUMNS} from access_keys order by created_at`)
    return result.rows
  }

  async listSummaries(): Promise<AdminKeySummaryRow[]> {
    const keys = await this.list()
    const deviceRows = await this.db.query<{ key_id: string; count: string }>(
      'select key_id, count(*)::text as count from devices group by key_id',
    )
    const nodeRows = await this.db.query<{ namespace_id: string; count: string }>(
      'select namespace_id, count(*)::text as count from bookmark_nodes where deleted_at is null group by namespace_id',
    )
    const deviceCounts = new Map(deviceRows.rows.map((row) => [row.key_id, Number(row.count)]))
    const nodeCounts = new Map(nodeRows.rows.map((row) => [row.namespace_id, Number(row.count)]))
    return keys.map((key) => ({
      keyId: key.id,
      keyPrefix: key.keyPrefix,
      role: key.role,
      status: key.status,
      label: key.label,
      deviceCount: deviceCounts.get(key.id) ?? 0,
      nodeCount: nodeCounts.get(key.namespaceId) ?? 0,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      purgeAt: key.purgeAt,
    }))
  }

  async countAdmins(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      "select count(*)::text as count from access_keys where role = 'admin' and status = 'active'",
    )
    return Number(result.rows[0].count)
  }

  async touch(id: string): Promise<void> {
    await this.db.query('update access_keys set last_used_at = now() where id = $1', [id])
  }

  /** Rotates a Key secret: replaces the digest, bumps token version, revokes sessions. */
  async rotate(id: string, newPrefix: string, newSecretHash: string): Promise<AccessKeyRow> {
    const result = await this.db.query<AccessKeyRow>(
      `update access_keys
       set key_prefix = $2, secret_hash = $3,
           token_version = token_version + 1,
           status = 'active',
           revoked_at = null,
           purge_at = null
       where id = $1
       returning ${COLUMNS}`,
      [id, newPrefix, newSecretHash],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`key not found: ${id}`)
    return row
  }

  /** Soft-deletes a Key: status pending_delete, purge after retention, token version bumped. */
  async markPendingDelete(id: string, purgeAt: string): Promise<void> {
    await this.db.query(
      `update access_keys
       set status = 'pending_delete', revoked_at = now(), purge_at = $2,
           token_version = token_version + 1
       where id = $1`,
      [id, purgeAt],
    )
  }

  /** Restores a pending-delete Key with a brand-new secret; old device sessions stay revoked. */
  async restore(id: string, newPrefix: string, newSecretHash: string): Promise<AccessKeyRow> {
    const result = await this.db.query<AccessKeyRow>(
      `update access_keys
       set status = 'active', key_prefix = $2, secret_hash = $3,
           revoked_at = null, purge_at = null,
           token_version = token_version + 1
       where id = $1
       returning ${COLUMNS}`,
      [id, newPrefix, newSecretHash],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`key not found: ${id}`)
    return row
  }

  /** Administrator reset keeps the Key ID and namespace but replaces the digest. */
  async resetAdminSecret(id: string, newPrefix: string, newSecretHash: string): Promise<void> {
    await this.db.query(
      `update access_keys
       set key_prefix = $2, secret_hash = $3,
           token_version = token_version + 1,
           status = 'active',
           revoked_at = null,
           purge_at = null
       where id = $1`,
      [id, newPrefix, newSecretHash],
    )
  }

  async listExpiredPendingDeletion(): Promise<AccessKeyRow[]> {
    const result = await this.db.query<AccessKeyRow>(
      `select ${COLUMNS} from access_keys where status = 'pending_delete' and purge_at <= now()`,
    )
    return result.rows
  }
}
