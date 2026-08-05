import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>
}

export interface DbClient extends Queryable {
  release(): void
}

export const createPool = (connectionString: string): pg.Pool => new pg.Pool({ connectionString })

export const withTransaction = async <T>(
  pool: pg.Pool,
  work: (client: DbClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // rollback failure must not mask the original error
    }
    throw error
  } finally {
    client.release()
  }
}

const splitStatements = (sql: string): string[] => sql
  .split(/;\s*\n/)
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

export const migrate = async (pool: pg.Pool, migrationsDir: string): Promise<string[]> => {
  await pool.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  )
  const applied: string[] = []
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    const existing = await pool.query('select 1 from schema_migrations where name = $1', [file])
    if (existing.rowCount) continue
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8')
    await withTransaction(pool, async (client) => {
      for (const statement of splitStatements(sql)) {
        await client.query(statement)
      }
      await client.query('insert into schema_migrations (name) values ($1)', [file])
    })
    applied.push(file)
  }
  return applied
}
