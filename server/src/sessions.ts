import type pg from 'pg'
import type { ServerConfig } from './config'
import { hashToken, randomToken } from './crypto'
import { DeviceRepo } from './repos/devices'
import type { DeviceSessionLookup, AccessKeyRow } from './repos/types'

export interface IssuedSession {
  deviceId: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
  refreshTokenExpiresAt: string
}

export interface AuthContext {
  sessionId: string
  deviceId: string
  keyId: string
  keyPrefix: string
  namespaceId: string
  role: 'admin' | 'sync'
}

export class SessionService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: ServerConfig,
  ) {}

  async issueForDevice(key: AccessKeyRow, deviceId: string): Promise<IssuedSession> {
    const accessToken = randomToken()
    const refreshToken = randomToken()
    const accessExpiresAt = new Date(Date.now() + this.config.accessTokenTtlMinutes * 60_000).toISOString()
    const refreshExpiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000).toISOString()
    const devices = new DeviceRepo(this.pool)
    await devices.createSession(
      deviceId,
      hashToken(accessToken),
      hashToken(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      key.tokenVersion,
    )
    return {
      deviceId,
      accessToken,
      refreshToken,
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
    }
  }

  private toContext(session: DeviceSessionLookup): AuthContext {
    return {
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      keyId: session.keyId,
      keyPrefix: session.keyPrefix,
      namespaceId: session.namespaceId,
      role: session.role,
    }
  }

  /** Validates an opaque access token against device, Key status and token version. */
  async authenticateAccess(accessToken: string): Promise<AuthContext | null> {
    const devices = new DeviceRepo(this.pool)
    const session = await devices.findSessionByAccessTokenHash(hashToken(accessToken))
    if (!session) return null
    if (session.revokedAt) return null
    if (session.keyStatus !== 'active') return null
    if (session.keyTokenVersion !== session.currentKeyTokenVersion) return null
    if (new Date(session.accessExpiresAt).getTime() <= Date.now()) return null
    await devices.touchDevice(session.deviceId)
    return this.toContext(session)
  }

  /** Exchanges a refresh token for fresh opaque tokens, invalidating the old pair. */
  async refresh(refreshToken: string): Promise<IssuedSession | null> {
    const devices = new DeviceRepo(this.pool)
    const session = await devices.findSessionByRefreshTokenHash(hashToken(refreshToken))
    if (!session) return null
    if (session.revokedAt) return null
    if (session.keyStatus !== 'active') return null
    if (session.keyTokenVersion !== session.currentKeyTokenVersion) return null
    if (new Date(session.refreshExpiresAt).getTime() <= Date.now()) return null

    const accessToken = randomToken()
    const newRefreshToken = randomToken()
    const accessExpiresAt = new Date(Date.now() + this.config.accessTokenTtlMinutes * 60_000).toISOString()
    const refreshExpiresAt = new Date(Date.now() + this.config.refreshTokenTtlDays * 86_400_000).toISOString()
    await devices.rotateSession(
      session.sessionId,
      hashToken(accessToken),
      hashToken(newRefreshToken),
      accessExpiresAt,
      refreshExpiresAt,
    )
    await devices.touchDevice(session.deviceId)
    return {
      deviceId: session.deviceId,
      accessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
    }
  }

  async revoke(sessionId: string): Promise<void> {
    await new DeviceRepo(this.pool).revokeSession(sessionId)
  }
}
