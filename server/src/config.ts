import { z } from 'zod'
import { PROTOCOL_MIN_CLIENT_VERSION } from '@webwings/sync-protocol'

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1).optional(),
  SRKEY_PEPPER: z.string().min(16).optional(),
  WEBWINGS_INSTANCE_ID: z.string().min(1).optional(),
  WEBWINGS_ADMIN_SRKEY: z.string().optional(),
  WEBWINGS_ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  WEBWINGS_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(180),
  WEBWINGS_BIND_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  WEBWINGS_DELETE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  WEBWINGS_EVENT_RETENTION_COUNT: z.coerce.number().int().positive().default(2000),
  WEBWINGS_SNAPSHOT_INTERVAL_EVENTS: z.coerce.number().int().positive().default(500),
  WEBWINGS_MAX_PUSH_OPS: z.coerce.number().int().positive().default(200),
  WEBWINGS_MAX_NODES_PER_IMPORT: z.coerce.number().int().positive().default(5000),
  WEBWINGS_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export interface ServerConfig {
  port: number
  databaseUrl: string | undefined
  srkeyPepper: string
  instanceId: string | undefined
  adminSrkey: string | undefined
  accessTokenTtlMinutes: number
  refreshTokenTtlDays: number
  bindSessionTtlMinutes: number
  deleteRetentionDays: number
  eventRetentionCount: number
  snapshotIntervalEvents: number
  maxPushOps: number
  maxNodesPerImport: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  minClientVersion: string
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`invalid server configuration: ${issues}`)
  }
  const config = parsed.data
  const pepper = config.SRKEY_PEPPER ?? 'webwings-dev-pepper-do-not-use'
  return {
    port: config.PORT,
    databaseUrl: config.DATABASE_URL,
    srkeyPepper: pepper,
    instanceId: config.WEBWINGS_INSTANCE_ID,
    adminSrkey: config.WEBWINGS_ADMIN_SRKEY,
    accessTokenTtlMinutes: config.WEBWINGS_ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: config.WEBWINGS_REFRESH_TOKEN_TTL_DAYS,
    bindSessionTtlMinutes: config.WEBWINGS_BIND_SESSION_TTL_MINUTES,
    deleteRetentionDays: config.WEBWINGS_DELETE_RETENTION_DAYS,
    eventRetentionCount: config.WEBWINGS_EVENT_RETENTION_COUNT,
    snapshotIntervalEvents: config.WEBWINGS_SNAPSHOT_INTERVAL_EVENTS,
    maxPushOps: config.WEBWINGS_MAX_PUSH_OPS,
    maxNodesPerImport: config.WEBWINGS_MAX_NODES_PER_IMPORT,
    logLevel: config.WEBWINGS_LOG_LEVEL,
    minClientVersion: PROTOCOL_MIN_CLIENT_VERSION,
  }
}
