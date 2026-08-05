import { loadConfig } from '../config'
import { createPool } from '../db'
import { KeyService } from '../keys'
import { KeyRepo } from '../repos/keys'

/**
 * Controlled administrator srkey reset for lost-key recovery.
 * Usage: pnpm --filter webwings-server reset-admin [key-id]
 * Prints the new full srkey exactly once on stdout.
 */
const main = async () => {
  const config = loadConfig()
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required to reset the administrator srkey')
  const pool = createPool(config.databaseUrl)
  try {
    let keyId = process.argv[2]
    if (!keyId) {
      const admins = (await new KeyRepo(pool).list()).filter((key) => key.role === 'admin')
      if (admins.length !== 1) {
        throw new Error(
          `expected exactly one administrator key, found ${admins.length}; pass the target key id explicitly`,
        )
      }
      keyId = admins[0].id
    }
    const rawSrkey = await new KeyService(pool, config).resetAdminSecret(keyId)
    console.log(`Administrator srkey reset for key ${keyId}. Existing device sessions are revoked.`)
    console.log(`Save this value now; it will not be shown again:\n${rawSrkey}`)
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
