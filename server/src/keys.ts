import type pg from 'pg'
import type { AccessKeyRow, AdminKeySummaryRow } from './repos/types'
import type { ServerConfig } from './config'
import { withTransaction } from './db'
import { generateSrkey, hashSrkey, keyPrefix, newId, parseSrkey } from './crypto'
import { KeyRepo } from './repos/keys'
import { NamespaceRepo } from './repos/namespaces'
import { DeviceRepo } from './repos/devices'
import { conflict, forbidden, notFound } from './errors'

export interface BootstrapResult {
  created: boolean
  generatedSrkey?: string
}

/**
 * Lookup of a raw srkey with uniform failure semantics. Never leaks whether a
 * Key exists or which role it has on invalid input.
 */
export const validateSrkey = async (pool: pg.Pool, config: ServerConfig, rawSrkey: string): Promise<AccessKeyRow | null> => {
  try {
    parseSrkey(rawSrkey)
  } catch {
    return null
  }
  const hash = hashSrkey(config.srkeyPepper, rawSrkey)
  const key = await new KeyRepo(pool).findBySecretHash(hash)
  if (!key || key.status !== 'active') return null
  if (hash !== key.secretHash) return null
  return key
}

/**
 * First-start administrator bootstrap. Serializes on the singleton
 * server_settings row so concurrent instances never create a second admin.
 */
export const bootstrapAdmin = async (pool: pg.Pool, config: ServerConfig): Promise<BootstrapResult> => {
  await pool.query(
    `insert into server_settings (id, instance_id) values (1, $1)
     on conflict (id) do nothing`,
    [config.instanceId ?? newId()],
  )
  return withTransaction(pool, async (client) => {
    await client.query('select id from server_settings where id = 1 for update')
    const keys = new KeyRepo(client)
    if ((await keys.countAdmins()) > 0) return { created: false }

    let rawSrkey = config.adminSrkey
    let generated: string | undefined
    if (!rawSrkey) {
      rawSrkey = generateSrkey('admin')
      generated = rawSrkey
    } else {
      try {
        parseSrkey(rawSrkey)
      } catch {
        throw new Error('WEBWINGS_ADMIN_SRKEY must be a valid srk_admin_ key')
      }
    }
    const namespaceId = newId()
    await new NamespaceRepo(client).create(namespaceId)
    await keys.create({
      id: newId(),
      namespaceId,
      keyPrefix: keyPrefix(rawSrkey),
      secretHash: hashSrkey(config.srkeyPepper, rawSrkey),
      role: 'admin',
      label: 'default administrator',
    })
    return { created: true, generatedSrkey: generated }
  })
}

export class KeyService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: ServerConfig,
  ) {}

  private requireAdmin(role: 'admin' | 'sync'): void {
    if (role !== 'admin') throw forbidden('administrator privileges required')
  }

  async listForAdmin(role: 'admin' | 'sync'): Promise<AdminKeySummaryRow[]> {
    this.requireAdmin(role)
    return new KeyRepo(this.pool).listSummaries()
  }

  async createKey(role: 'admin' | 'sync', label?: string): Promise<{ keyId: string; keyPrefix: string; srkey: string; label: string | null }> {
    this.requireAdmin(role)
    const rawSrkey = generateSrkey('sync')
    const keyId = newId()
    const namespaceId = newId()
    await withTransaction(this.pool, async (client) => {
      await new NamespaceRepo(client).create(namespaceId)
      await new KeyRepo(client).create({
        id: keyId,
        namespaceId,
        keyPrefix: keyPrefix(rawSrkey),
        secretHash: hashSrkey(this.config.srkeyPepper, rawSrkey),
        role: 'sync',
        label: label ?? null,
      })
    })
    return { keyId, keyPrefix: keyPrefix(rawSrkey), srkey: rawSrkey, label: label ?? null }
  }

  async rotateKey(role: 'admin' | 'sync', keyId: string): Promise<{ keyId: string; keyPrefix: string; srkey: string }> {
    this.requireAdmin(role)
    const rawSrkey = generateSrkey('sync')
    return withTransaction(this.pool, async (client) => {
      const keys = new KeyRepo(client)
      const existing = await keys.get(keyId)
      if (!existing) throw notFound('key not found')
      await new DeviceRepo(client).revokeAllForKey(keyId)
      await keys.rotate(keyId, keyPrefix(rawSrkey), hashSrkey(this.config.srkeyPepper, rawSrkey))
      return { keyId, keyPrefix: keyPrefix(rawSrkey), srkey: rawSrkey }
    })
  }

  async deleteKey(role: 'admin' | 'sync', keyId: string): Promise<void> {
    this.requireAdmin(role)
    await withTransaction(this.pool, async (client) => {
      const keys = new KeyRepo(client)
      const existing = await keys.get(keyId)
      if (!existing) throw notFound('key not found')
      if (existing.role === 'admin' && (await keys.countAdmins()) <= 1) {
        throw conflict('only_admin', 'cannot delete the only administrator key')
      }
      await new DeviceRepo(client).revokeAllForKey(keyId)
      const purgeAt = new Date(Date.now() + this.config.deleteRetentionDays * 86_400_000).toISOString()
      await keys.markPendingDelete(keyId, purgeAt)
    })
  }

  async restoreKey(role: 'admin' | 'sync', keyId: string): Promise<{ keyId: string; keyPrefix: string; srkey: string }> {
    this.requireAdmin(role)
    const rawSrkey = generateSrkey('sync')
    return withTransaction(this.pool, async (client) => {
      const keys = new KeyRepo(client)
      const existing = await keys.get(keyId)
      if (!existing || existing.status !== 'pending_delete') {
        throw notFound('key not found or not pending delete')
      }
      await keys.restore(keyId, keyPrefix(rawSrkey), hashSrkey(this.config.srkeyPepper, rawSrkey))
      return { keyId, keyPrefix: keyPrefix(rawSrkey), srkey: rawSrkey }
    })
  }

  /**
   * Controlled administrator reset used by the maintenance script. Keeps the
   * admin Key ID and namespace; bumps token version and revokes all sessions.
   */
  async resetAdminSecret(keyId: string): Promise<string> {
    const rawSrkey = generateSrkey('admin')
    await withTransaction(this.pool, async (client) => {
      const keys = new KeyRepo(client)
      const existing = await keys.get(keyId)
      if (!existing || existing.role !== 'admin') {
        throw notFound('administrator key not found')
      }
      await new DeviceRepo(client).revokeAllForKey(keyId)
      await keys.resetAdminSecret(keyId, keyPrefix(rawSrkey), hashSrkey(this.config.srkeyPepper, rawSrkey))
    })
    return rawSrkey
  }
}
