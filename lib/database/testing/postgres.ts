import type { Client as PostgresClient } from 'pg'

// Each Vitest worker needs its own PostgreSQL database. `prepare()` drops and
// recreates the database before loading the schema, so a single shared name lets
// one worker destroy the database another worker is running tests against — which
// surfaces as `relation "..." does not exist` or `Connection terminated
// unexpectedly` in whichever file lost the race. Vitest hands files to a worker
// one at a time, so a name per worker is enough isolation; `VITEST_POOL_ID` is
// unique across the workers running concurrently. Strip it to digits: it is
// interpolated into `CREATE`/`DROP DATABASE`, which cannot be parameterised.
const TEST_PG_WORKER_ID = (process.env.VITEST_POOL_ID ?? '').replace(/\D/g, '')
export const TEST_PG_DATABASE = TEST_PG_WORKER_ID
  ? `test_${TEST_PG_WORKER_ID}`
  : 'test'
export const getTestPgPort = (
  rawPort: string | undefined = process.env.TEST_DATABASE_PORT
): number => {
  if (rawPort === undefined) {
    return 5432
  }
  if (!/^[1-9]\d*$/.test(rawPort)) {
    throw new Error(
      `Invalid TEST_DATABASE_PORT "${rawPort}": must be a decimal integer between 1 and 65535`
    )
  }
  const port = Number.parseInt(rawPort, 10)
  if (port > 65535) {
    throw new Error(
      `Invalid TEST_DATABASE_PORT "${rawPort}": must be a decimal integer between 1 and 65535`
    )
  }
  return port
}

export const getTestPgConnection = () => ({
  host: process.env.TEST_DATABASE_HOST,
  port: getTestPgPort(),
  user: process.env.TEST_DATABASE_USERNAME,
  password: process.env.TEST_DATABASE_PASSWORD
})

type PgConnection = ReturnType<typeof getTestPgConnection>

/**
 * Drops and recreates `databaseName` through the maintenance database, so the
 * schema loader starts from an empty database.
 */
export const recreatePgDatabase = async (
  connection: PgConnection,
  databaseName: string
) => {
  const { Client: DynamicPostgresClient } = await import('pg')
  const client = new (
    DynamicPostgresClient as unknown as typeof PostgresClient
  )({
    ...connection,
    database: 'postgres'
  })
  await client.connect()
  await client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`)
  await client.query(`CREATE DATABASE ${databaseName}`)
  await client.end()
}
