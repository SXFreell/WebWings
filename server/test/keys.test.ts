import { beforeEach, describe, expect, it } from 'vitest'
import { generateSrkey } from '../src/crypto'
import { bootstrapAdmin, KeyService, validateSrkey } from '../src/keys'
import { KeyRepo } from '../src/repos/keys'
import { NamespaceRepo } from '../src/repos/namespaces'
import { createPgMemPool, testConfig } from './helpers/pgmem'

describe('administrator bootstrap and key management', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>

  beforeEach(async () => {
    pool = await createPgMemPool()
  })

  it('bootstraps exactly one admin with a generated srkey shown once', async () => {
    const config = testConfig()
    const first = await bootstrapAdmin(pool, config)
    expect(first.created).toBe(true)
    expect(first.generatedSrkey?.startsWith('srk_admin_')).toBe(true)

    const second = await bootstrapAdmin(pool, config)
    expect(second.created).toBe(false)
    expect(second.generatedSrkey).toBeUndefined()

    expect(await new KeyRepo(pool).countAdmins()).toBe(1)
    const key = await validateSrkey(pool, config, first.generatedSrkey!)
    expect(key?.role).toBe('admin')
    expect(key?.namespaceId).toBeTruthy()
    expect(await new NamespaceRepo(pool).get(key!.namespaceId)).not.toBeNull()
  })

  it('uses WEBWINGS_ADMIN_SRKEY when provided and never reveals it again', async () => {
    const raw = generateSrkey('admin')
    const config = testConfig()
    config.adminSrkey = raw
    const result = await bootstrapAdmin(pool, config)
    expect(result.created).toBe(true)
    expect(result.generatedSrkey).toBeUndefined()
    expect((await validateSrkey(pool, config, raw))?.role).toBe('admin')
  })

  it('rejects a malformed configured admin srkey', async () => {
    const config = testConfig()
    config.adminSrkey = 'definitely-not-a-srkey'
    await expect(bootstrapAdmin(pool, config)).rejects.toThrow(/WEBWINGS_ADMIN_SRKEY/)
  })

  it('fails uniformly for unknown, malformed and revoked keys', async () => {
    const config = testConfig()
    const boot = await bootstrapAdmin(pool, config)
    expect(await validateSrkey(pool, config, 'srk_sync_0000000000000000000000000000000000000000000')).toBeNull()
    expect(await validateSrkey(pool, config, 'not-a-key')).toBeNull()
    expect(await validateSrkey(pool, config, boot.generatedSrkey!)).not.toBeNull()
    const adminKey = await validateSrkey(pool, config, boot.generatedSrkey!)
    await new KeyRepo(pool).markPendingDelete(adminKey!.id, '2099-01-01T00:00:00Z')
    expect(await validateSrkey(pool, config, boot.generatedSrkey!)).toBeNull()
  })

  it('creates, lists, rotates, deletes and restores normal keys with namespace preservation', async () => {
    const config = testConfig()
    await bootstrapAdmin(pool, config)
    const service = new KeyService(pool, config)

    const created = await service.createKey('admin', 'work laptop')
    expect(created.srkey.startsWith('srk_sync_')).toBe(true)
    expect(created.label).toBe('work laptop')

    const summaries = await service.listForAdmin('admin')
    expect(summaries.some((s) => s.keyId === created.keyId && s.label === 'work laptop')).toBe(true)
    expect(summaries.every((s) => !s.keyPrefix.includes('full'))).toBe(true)

    const rotated = await service.rotateKey('admin', created.keyId)
    expect(rotated.keyId).toBe(created.keyId)
    expect(rotated.srkey).not.toBe(created.srkey)
    expect(await validateSrkey(pool, config, created.srkey)).toBeNull()
    expect((await validateSrkey(pool, config, rotated.srkey))?.namespaceId).toBe(
      (await new KeyRepo(pool).get(created.keyId))?.namespaceId,
    )

    await service.deleteKey('admin', created.keyId)
    const deleted = await new KeyRepo(pool).get(created.keyId)
    expect(deleted?.status).toBe('pending_delete')
    expect(deleted?.purgeAt).not.toBeNull()
    expect(await validateSrkey(pool, config, rotated.srkey)).toBeNull()

    const restored = await service.restoreKey('admin', created.keyId)
    expect(restored.srkey.startsWith('srk_sync_')).toBe(true)
    expect((await new KeyRepo(pool).get(created.keyId))?.status).toBe('active')
  })

  it('protects the only administrator from deletion and forbids normal key management', async () => {
    const config = testConfig()
    await bootstrapAdmin(pool, config)
    const service = new KeyService(pool, config)
    const summaries = await service.listForAdmin('admin')
    const adminId = summaries.find((s) => s.role === 'admin')!.keyId
    await expect(service.deleteKey('admin', adminId)).rejects.toMatchObject({ code: 'only_admin' })
    await expect(service.createKey('sync', 'x')).rejects.toMatchObject({ statusCode: 403 })
    await expect(service.listForAdmin('sync')).rejects.toMatchObject({ statusCode: 403 })
  })
})
