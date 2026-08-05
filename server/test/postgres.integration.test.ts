import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createPool, migrate } from '../src/db'
import { bootstrapAdmin } from '../src/keys'
import { KeyRepo } from '../src/repos/keys'
import { SessionService } from '../src/sessions'
import { OperationService } from '../src/services/operations'
import { testConfig } from './helpers/pgmem'

const databaseUrl = process.env.DATABASE_URL
const describePostgres = databaseUrl ? describe : describe.skip

describePostgres('PostgreSQL integration', () => {
  const pool = createPool(databaseUrl!)
  const config = testConfig()

  beforeAll(async () => {
    await migrate(pool, fileURLToPath(new URL('../migrations', import.meta.url)))
    await bootstrapAdmin(pool, config)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('migrates the schema and persists an authenticated operation', async () => {
    const key = (await new KeyRepo(pool).list())[0]
    const sessions = new SessionService(pool, config)
    const device = await new (await import('../src/repos/devices')).DeviceRepo(pool).createDevice(key.id, 'postgres-ci', null)
    const issued = await sessions.issueForDevice(key, device.id)
    const context = await sessions.authenticateAccess(issued.accessToken)
    expect(context?.namespaceId).toBe(key.namespaceId)

    const receipt = await new OperationService(pool, config.maxNodesPerImport).push(context!, [{
      v: 1,
      opId: 'postgres-ci-create',
      deviceId: device.id,
      syncEpoch: 1,
      type: 'create_node',
      node: {
        id: 'postgres-ci-node',
        type: 'bookmark',
        parentId: null,
        title: 'PostgreSQL CI',
        url: 'https://example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }])
    expect(receipt[0].status).toBe('accepted')
    expect((await pool.query('select id from bookmark_nodes where namespace_id = $1', [key.namespaceId])).rows).toEqual([{ id: 'postgres-ci-node' }])
  })
})
