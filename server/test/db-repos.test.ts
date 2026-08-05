import { beforeEach, describe, expect, it } from 'vitest'
import { withTransaction } from '../src/db'
import { DeviceRepo } from '../src/repos/devices'
import { EventRepo, ReceiptRepo } from '../src/repos/events'
import { KeyRepo } from '../src/repos/keys'
import { NamespaceRepo } from '../src/repos/namespaces'
import { NodeRepo } from '../src/repos/nodes'
import { createPgMemPool } from './helpers/pgmem'

const seedNamespaceAndKey = async (
  pool: Awaited<ReturnType<typeof createPgMemPool>>,
  id: string,
  role: 'admin' | 'sync' = 'sync',
) => {
  await withTransaction(pool, async (client) => {
    const namespaces = new NamespaceRepo(client)
    await namespaces.create(id)
    await new KeyRepo(client).create({
      id: `key_${id}`,
      namespaceId: id,
      keyPrefix: `srk_sync_${id.slice(0, 4)}`,
      secretHash: `hash_${id}`,
      role,
      label: null,
    })
  })
  return id
}

const seedNode = async (pool: Awaited<ReturnType<typeof createPgMemPool>>, namespaceId: string, id: string) => {
  await withTransaction(pool, async (client) => {
    const nodes = new NodeRepo(client)
    await nodes.insert(
      namespaceId,
      {
        id,
        type: 'bookmark',
        parentId: '',
        title: `title ${id}`,
        url: 'https://example.com',
        positionKey: '0000000000000000000000000000000000001000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      1,
      1,
    )
  })
}

describe('database repositories', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>

  beforeEach(async () => {
    pool = await createPgMemPool()
  })

  it('runs the full migration and allocates monotonic namespace sequences', async () => {
    await seedNamespaceAndKey(pool, 'ns_a')
    const seqs: number[] = []
    for (let i = 0; i < 5; i += 1) {
      await withTransaction(pool, async (client) => {
        seqs.push(await new NamespaceRepo(client).allocateSeq('ns_a'))
      })
    }
    expect(seqs).toEqual([1, 2, 3, 4, 5])
    const ns = await new NamespaceRepo(pool).get('ns_a')
    expect(ns?.currentSeq).toBe(5)
    expect(ns?.syncEpoch).toBe(1)
  })

  it('keeps identical node ids isolated per namespace', async () => {
    await seedNamespaceAndKey(pool, 'ns_a')
    await seedNamespaceAndKey(pool, 'ns_b')
    await seedNode(pool, 'ns_a', 'node-1')
    await seedNode(pool, 'ns_b', 'node-1')

    const nodes = new NodeRepo(pool)
    const a = await nodes.get('ns_a', 'node-1')
    const b = await nodes.get('ns_b', 'node-1')
    expect(a?.title).toBe('title node-1')
    expect(b?.title).toBe('title node-1')
    expect(await nodes.countActive('ns_a')).toBe(1)
    expect(await nodes.countActive('ns_b')).toBe(1)
    expect((await nodes.getActiveNodes('ns_a')).map((n) => n.namespaceId)).toEqual(['ns_a'])
  })

  it('never lets events or receipts cross namespaces', async () => {
    await seedNamespaceAndKey(pool, 'ns_a')
    await seedNamespaceAndKey(pool, 'ns_b')
    await withTransaction(pool, async (client) => {
      const events = new EventRepo(client)
      const receipts = new ReceiptRepo(client)
      const namespaces = new NamespaceRepo(client)
      const seq = await namespaces.allocateSeq('ns_a')
      await events.append('ns_a', 1, seq, 'op-1', 'dev-1', 'created', { id: 'node-1' })
      await receipts.insert('ns_a', 'op-1', seq, 'accepted', null, { ok: true })
    })

    const events = new EventRepo(pool)
    const receipts = new ReceiptRepo(pool)
    expect((await events.listAfter('ns_a', 0, 10)).length).toBe(1)
    expect((await events.listAfter('ns_b', 0, 10)).length).toBe(0)
    expect((await receipts.get('ns_b', 'op-1'))).toBeNull()
    expect((await receipts.get('ns_a', 'op-1'))?.status).toBe('accepted')
  })

  it('issues isolated device sessions and revokes them per key', async () => {
    await seedNamespaceAndKey(pool, 'ns_a')
    await seedNamespaceAndKey(pool, 'ns_b')
    const devices = new DeviceRepo(pool)
    const deviceA = await devices.createDevice('key_ns_a', 'dev A', null)
    const deviceB = await devices.createDevice('key_ns_b', 'dev B', null)
    await devices.createSession(deviceA.id, 'access-a', 'refresh-a', '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z', 1)
    await devices.createSession(deviceB.id, 'access-b', 'refresh-b', '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z', 1)

    const lookupA = await devices.findSessionByAccessTokenHash('access-a')
    const lookupB = await devices.findSessionByAccessTokenHash('access-b')
    expect(lookupA?.keyId).toBe('key_ns_a')
    expect(lookupB?.keyId).toBe('key_ns_b')

    await devices.revokeAllForKey('key_ns_a')
    expect((await devices.findSessionByAccessTokenHash('access-a'))?.revokedAt).not.toBeNull()
    expect((await devices.findSessionByAccessTokenHash('access-b'))?.revokedAt).toBeNull()
  })

  it('bumps token version and rotates the secret digest while preserving the key id', async () => {
    await seedNamespaceAndKey(pool, 'ns_a')
    const keys = new KeyRepo(pool)
    const before = await keys.get('key_ns_a')
    const rotated = await keys.rotate('key_ns_a', 'srk_sync_newp', 'hash_new')
    expect(rotated.id).toBe('key_ns_a')
    expect(rotated.namespaceId).toBe('ns_a')
    expect(rotated.secretHash).toBe('hash_new')
    expect(rotated.tokenVersion).toBe((before?.tokenVersion ?? 0) + 1)
  })
})
