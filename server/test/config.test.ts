import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

describe('server configuration', () => {
  it('applies safe defaults when nothing is set', () => {
    const config = loadConfig({})
    expect(config.port).toBe(8787)
    expect(config.databaseUrl).toBeUndefined()
    expect(config.srkeyPepper.length).toBeGreaterThanOrEqual(16)
    expect(config.instanceId).toBeUndefined()
    expect(config.accessTokenTtlMinutes).toBe(60)
    expect(config.refreshTokenTtlDays).toBe(180)
    expect(config.bindSessionTtlMinutes).toBe(120)
    expect(config.deleteRetentionDays).toBe(30)
    expect(config.eventRetentionCount).toBe(2000)
    expect(config.snapshotIntervalEvents).toBe(500)
    expect(config.maxPushOps).toBe(200)
    expect(config.maxNodesPerImport).toBe(5000)
    expect(config.logLevel).toBe('info')
    expect(config.minClientVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('honors environment overrides and coerces numeric values', () => {
    const config = loadConfig({
      PORT: '9090',
      DATABASE_URL: 'postgres://localhost/webwings',
      SRKEY_PEPPER: 'a-very-long-pepper-value-for-tests',
      WEBWINGS_INSTANCE_ID: 'srv_test',
      WEBWINGS_ADMIN_SRKEY: 'srk_admin_secret',
      WEBWINGS_ACCESS_TOKEN_TTL_MINUTES: '15',
      WEBWINGS_REFRESH_TOKEN_TTL_DAYS: '30',
      WEBWINGS_BIND_SESSION_TTL_MINUTES: '10',
      WEBWINGS_DELETE_RETENTION_DAYS: '7',
      WEBWINGS_EVENT_RETENTION_COUNT: '100',
      WEBWINGS_SNAPSHOT_INTERVAL_EVENTS: '20',
      WEBWINGS_MAX_PUSH_OPS: '5',
      WEBWINGS_MAX_NODES_PER_IMPORT: '50',
      WEBWINGS_LOG_LEVEL: 'debug',
    })
    expect(config.port).toBe(9090)
    expect(config.databaseUrl).toBe('postgres://localhost/webwings')
    expect(config.srkeyPepper).toBe('a-very-long-pepper-value-for-tests')
    expect(config.instanceId).toBe('srv_test')
    expect(config.adminSrkey).toBe('srk_admin_secret')
    expect(config.accessTokenTtlMinutes).toBe(15)
    expect(config.refreshTokenTtlDays).toBe(30)
    expect(config.bindSessionTtlMinutes).toBe(10)
    expect(config.deleteRetentionDays).toBe(7)
    expect(config.eventRetentionCount).toBe(100)
    expect(config.snapshotIntervalEvents).toBe(20)
    expect(config.maxPushOps).toBe(5)
    expect(config.maxNodesPerImport).toBe(50)
    expect(config.logLevel).toBe('debug')
  })

  it('rejects invalid numeric values and unknown log levels', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/invalid server configuration/)
    expect(() => loadConfig({ PORT: '0' })).toThrow(/invalid server configuration/)
    expect(() => loadConfig({ WEBWINGS_LOG_LEVEL: 'trace' })).toThrow(/invalid server configuration/)
    expect(() => loadConfig({ SRKEY_PEPPER: 'short' })).toThrow(/invalid server configuration/)
  })
})
