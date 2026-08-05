import { randomUUID } from 'node:crypto'
import type { Queryable } from '../db'
import type { DeviceRow, DeviceSessionLookup } from './types'

export class DeviceRepo {
  constructor(private readonly db: Queryable) {}

  async createDevice(keyId: string, name: string | null, info: string | null): Promise<DeviceRow> {
    const result = await this.db.query<DeviceRow>(
      'insert into devices (id, key_id, name, info) values ($1, $2, $3, $4) returning *',
      [randomUUID(), keyId, name, info],
    )
    return result.rows[0]
  }

  async createSession(
    deviceId: string,
    accessTokenHash: string,
    refreshTokenHash: string,
    accessExpiresAt: string,
    refreshExpiresAt: string,
    keyTokenVersion: number,
  ): Promise<void> {
    await this.db.query(
      `insert into device_sessions
        (id, device_id, access_token_hash, refresh_token_hash, access_expires_at,
         refresh_expires_at, key_token_version)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), deviceId, accessTokenHash, refreshTokenHash, accessExpiresAt, refreshExpiresAt, keyTokenVersion],
    )
  }

  /** Rotates both opaque tokens of an existing session and extends its lifetime. */
  async rotateSession(
    sessionId: string,
    accessTokenHash: string,
    refreshTokenHash: string,
    accessExpiresAt: string,
    refreshExpiresAt: string,
  ): Promise<void> {
    await this.db.query(
      `update device_sessions
       set access_token_hash = $2, refresh_token_hash = $3,
           access_expires_at = $4, refresh_expires_at = $5
       where id = $1 and revoked_at is null`,
      [sessionId, accessTokenHash, refreshTokenHash, accessExpiresAt, refreshExpiresAt],
    )
  }

  async findSessionByAccessTokenHash(hash: string): Promise<DeviceSessionLookup | null> {
    const result = await this.db.query<DeviceSessionLookup>(
      `select s.id as "sessionId", s.access_expires_at as "accessExpiresAt",
              s.refresh_expires_at as "refreshExpiresAt", s.revoked_at as "revokedAt",
              s.key_token_version as "keyTokenVersion",
              d.id as "deviceId", d.name as "deviceName",
              k.id as "keyId", k.key_prefix as "keyPrefix", k.namespace_id as "namespaceId",
              k.role, k.status as "keyStatus", k.token_version as "currentKeyTokenVersion"
       from device_sessions s
       join devices d on d.id = s.device_id
       join access_keys k on k.id = d.key_id
       where s.access_token_hash = $1`,
      [hash],
    )
    return result.rows[0] ?? null
  }

  async findSessionByRefreshTokenHash(hash: string): Promise<DeviceSessionLookup | null> {
    const result = await this.db.query<DeviceSessionLookup>(
      `select s.id as "sessionId", s.access_expires_at as "accessExpiresAt",
              s.refresh_expires_at as "refreshExpiresAt", s.revoked_at as "revokedAt",
              s.key_token_version as "keyTokenVersion",
              d.id as "deviceId", d.name as "deviceName",
              k.id as "keyId", k.key_prefix as "keyPrefix", k.namespace_id as "namespaceId",
              k.role, k.status as "keyStatus", k.token_version as "currentKeyTokenVersion"
       from device_sessions s
       join devices d on d.id = s.device_id
       join access_keys k on k.id = d.key_id
       where s.refresh_token_hash = $1`,
      [hash],
    )
    return result.rows[0] ?? null
  }

  async revokeSession(id: string): Promise<void> {
    await this.db.query('update device_sessions set revoked_at = now() where id = $1', [id])
  }

  async revokeAllForKey(keyId: string): Promise<void> {
    await this.db.query(
      `update device_sessions set revoked_at = now()
       where revoked_at is null and device_id in (select id from devices where key_id = $1)`,
      [keyId],
    )
  }

  async touchDevice(id: string): Promise<void> {
    await this.db.query('update devices set last_seen_at = now() where id = $1', [id])
  }
}
