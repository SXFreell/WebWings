import { beforeEach, describe, expect, it } from 'vitest'
import { generateSrkey } from '../src/crypto'
import { bootstrapAdmin, validateSrkey } from '../src/keys'
import { DeviceRepo } from '../src/repos/devices'
import { KeyRepo } from '../src/repos/keys'
import { SessionService } from '../src/sessions'
import { createPgMemPool, testConfig } from './helpers/pgmem'

describe('device sessions', () => {
  let pool: Awaited<ReturnType<typeof createPgMemPool>>

  beforeEach(async () => {
    pool = await createPgMemPool()
  })

  const setup = async () => {
    const config = testConfig()
    const boot = await bootstrapAdmin(pool, config)
    const key = await validateSrkey(pool, config, boot.generatedSrkey!)
    const device = await new DeviceRepo(pool).createDevice(key!.id, 'test device', null)
    return { config, key: key!, deviceId: device.id, sessions: new SessionService(pool, config) }
  }

  it('issues opaque sessions and authenticates with the access token', async () => {
    const { config, key, deviceId, sessions } = await setup()
    const issued = await sessions.issueForDevice(key, deviceId)
    expect(issued.accessToken).not.toBe(key.secretHash)
    expect(issued.accessToken.length).toBeGreaterThan(40)

    const context = await sessions.authenticateAccess(issued.accessToken)
    expect(context?.keyId).toBe(key.id)
    expect(context?.namespaceId).toBe(key.namespaceId)
    expect(context?.role).toBe('admin')
    expect(await sessions.authenticateAccess('bogus-token')).toBeNull()
    expect(await sessions.authenticateAccess(issued.refreshToken)).toBeNull()
    void config
  })

  it('rotates tokens on refresh and rejects the old pair', async () => {
    const { key, deviceId, sessions } = await setup()
    const issued = await sessions.issueForDevice(key, deviceId)
    const refreshed = await sessions.refresh(issued.refreshToken)
    expect(refreshed?.accessToken).not.toBe(issued.accessToken)
    expect(await sessions.refresh(issued.refreshToken)).toBeNull()
    expect((await sessions.authenticateAccess(refreshed!.accessToken))?.deviceId).toBe(deviceId)
  })

  it('invalidates sessions when the key is rotated or revoked', async () => {
    const { config, key, deviceId, sessions } = await setup()
    const issued = await sessions.issueForDevice(key, deviceId)

    await new KeyRepo(pool).rotate(key.id, 'srk_admin_xxxx', 'new-secret-hash')
    expect(await sessions.authenticateAccess(issued.accessToken)).toBeNull()
    expect(await sessions.refresh(issued.refreshToken)).toBeNull()
    void config
  })

  it('rejects expired and explicitly revoked sessions', async () => {
    const { key, deviceId, sessions } = await setup()
    const issued = await sessions.issueForDevice(key, deviceId)
    await pool.query('update device_sessions set access_expires_at = now() - interval \'1 hour\'')
    expect(await sessions.authenticateAccess(issued.accessToken)).toBeNull()
  })

  it('revokes a session explicitly', async () => {
    const { key, deviceId, sessions } = await setup()
    const issued = await sessions.issueForDevice(key, deviceId)
    const context = await sessions.authenticateAccess(issued.accessToken)
    await sessions.revoke(context!.sessionId)
    expect(await sessions.authenticateAccess(issued.accessToken)).toBeNull()
    expect(await sessions.refresh(issued.refreshToken)).toBeNull()
  })
})
