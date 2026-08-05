import { fileURLToPath } from 'node:url'
import { newDb } from 'pg-mem'
import { migrate } from '../../src/db'
import { loadConfig } from '../../src/config'

export const createPgMemPool = async () => {
  const db = newDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  await migrate(pool, fileURLToPath(new URL('../../migrations', import.meta.url)))
  return pool
}

export const testConfig = (overrides: Record<string, string> = {}) =>
  loadConfig({
    SRKEY_PEPPER: 'test-pepper-value-with-enough-length',
    WEBWINGS_INSTANCE_ID: 'srv_test_instance',
    WEBWINGS_ADMIN_SRKEY: undefined,
    WEBWINGS_ACCESS_TOKEN_TTL_MINUTES: '60',
    WEBWINGS_REFRESH_TOKEN_TTL_DAYS: '180',
    WEBWINGS_BIND_SESSION_TTL_MINUTES: '120',
    WEBWINGS_DELETE_RETENTION_DAYS: '30',
    ...overrides,
  })
