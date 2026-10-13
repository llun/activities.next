import { z } from 'zod'

import { logger } from '@/lib/utils/logger'

import { matcher } from './utils'

// The database the application connects to (lib/database/connection.ts). It
// is still the subset of a Knex configuration the app has always accepted, so
// `ACTIVITIES_DATABASE` JSON written for Knex keeps working and the Knex-based
// tools that remain (the migration CLI and the production archive script) can
// be handed the same object:
//
// - better-sqlite3: `connection.filename` (a bare string is the filename).
//   `useNullAsDefault` is always set, for those Knex tools.
// - pg: `connection` is a node-postgres client configuration (`host`, `port`,
//   `user`, `password`, `database`, `ssl`, `application_name`, …) or a
//   connection string (absent in the JSON: `{}`, so node-postgres reads the
//   `PG*` environment variables; Knex built no pool without `connection`, so
//   `yarn migrate` still needs it); `pool.min` / `pool.max` size
//   the pool (Knex's defaults, 2 and 10, when `pool` is absent);
//   `acquireConnectionTimeout` is how long a query waits for a free pooled
//   connection, in milliseconds (60 000 when unset).
//
// Other keys in the JSON (Knex's `searchPath`, `debug`, pool hooks and timers,
// …) are ignored with a warning naming them.

// Knex's pool size when the configuration has no `pool`.
export const DEFAULT_POSTGRES_POOL = { min: 2, max: 10 }

// The pool sizes Knex could use: tarn refused a `min` that is not a whole
// number >= 0, a `max` that is not a whole number > 0 (except 0, for which
// Knex built no pool, so every query failed) and a `min` above the `max`.
// All of them are refused here, when the configuration is read.
const getPoolSizeProblem = (min: number, max: number) => {
  if (!Number.isInteger(min) || min < 0) return 'min must be an integer >= 0'
  if (!Number.isInteger(max) || max <= 0) return 'max must be an integer > 0'
  if (min > max) return 'max is smaller than min'
  return null
}

const SqliteDatabaseConfig = z.object({
  client: z.literal('better-sqlite3'),
  connection: z.object({ filename: z.string().min(1) }),
  useNullAsDefault: z.literal(true)
})

const PostgresDatabaseConfig = z
  .object({
    client: z.literal('pg'),
    connection: z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
    pool: z
      .object({
        min: z.number().optional(),
        max: z.number().optional()
      })
      .optional(),
    // Knex took the smallest of its timeouts with Math.min, which turned a
    // numeric string such as "30000" into a number; tarn then refused anything
    // that is not a whole number > 0 ("abc" became NaN), as it is here.
    acquireConnectionTimeout: z.coerce.number().int().positive().optional()
  })
  .superRefine(({ pool }, context) => {
    const problem = getPoolSizeProblem(
      pool?.min ?? DEFAULT_POSTGRES_POOL.min,
      pool?.max ?? DEFAULT_POSTGRES_POOL.max
    )
    if (problem) {
      context.addIssue({
        code: 'custom',
        path: ['pool'],
        message: `pool.${problem}`
      })
    }
  })

export const DatabaseConfig = z.discriminatedUnion('client', [
  SqliteDatabaseConfig,
  PostgresDatabaseConfig
])
export type DatabaseConfig = z.infer<typeof DatabaseConfig>
export type PostgresDatabaseConfig = z.infer<typeof PostgresDatabaseConfig>

const unsupportedClientError = (client: string) =>
  new Error(
    `Unsupported database client "${client}": ` +
      'only better-sqlite3 (SQLite) and pg (PostgreSQL) are supported; ' +
      'set ACTIVITIES_DATABASE_CLIENT accordingly (see docs/setup.md).'
  )

// Knex's names for its PostgreSQL client; all of them use node-postgres.
const POSTGRES_CLIENTS = new Set(['pg', 'postgres', 'postgresql'])
const TOP_LEVEL_KEYS = new Set([
  'client',
  'connection',
  'pool',
  'acquireConnectionTimeout',
  'useNullAsDefault'
])
const POOL_KEYS = new Set(['min', 'max'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const warnIgnoredKeys = (keys: string[]) => {
  if (keys.length === 0) return
  logger.warn(
    { keys },
    'ACTIVITIES_DATABASE has settings the database connection does not use; they are ignored'
  )
}

/**
 * Reads the Knex-shaped `ACTIVITIES_DATABASE` JSON into a `DatabaseConfig`.
 * Throws for a client other than better-sqlite3 or pg, or a value of the wrong
 * type; warns about keys it does not use.
 */
export const parseKnexDatabaseConfig = (value: unknown): DatabaseConfig => {
  if (!isObject(value)) {
    throw new Error('ACTIVITIES_DATABASE must be a JSON object')
  }
  const client = String(value.client ?? '')
  const ignored = Object.keys(value).filter((key) => !TOP_LEVEL_KEYS.has(key))

  if (client === 'better-sqlite3') {
    const connection = value.connection
    const filename =
      typeof connection === 'string'
        ? connection
        : isObject(connection)
          ? connection.filename
          : undefined
    if (isObject(connection)) {
      ignored.push(
        ...Object.keys(connection)
          .filter((key) => key !== 'filename')
          .map((key) => `connection.${key}`)
      )
    }
    for (const key of ['pool', 'acquireConnectionTimeout']) {
      if (key in value) ignored.push(key)
    }
    warnIgnoredKeys(ignored)
    return SqliteDatabaseConfig.parse({
      client,
      connection: { filename },
      useNullAsDefault: true
    })
  }

  if (POSTGRES_CLIENTS.has(client)) {
    const pool = value.pool
    if (isObject(pool)) {
      ignored.push(
        ...Object.keys(pool)
          .filter((key) => !POOL_KEYS.has(key))
          .map((key) => `pool.${key}`)
      )
    }
    if ('useNullAsDefault' in value) ignored.push('useNullAsDefault')
    warnIgnoredKeys(ignored)
    return PostgresDatabaseConfig.parse({
      client: 'pg',
      // Knex built no pool without a connection (every query failed with
      // "Unable to acquire a connection"); here it is `{}`, and node-postgres
      // takes the host, user, password and database from the PG* environment
      // variables.
      connection: value.connection || {},
      ...(isObject(pool)
        ? {
            pool: {
              ...(pool.min !== undefined ? { min: pool.min } : {}),
              ...(pool.max !== undefined ? { max: pool.max } : {})
            }
          }
        : {}),
      ...(value.acquireConnectionTimeout !== undefined
        ? { acquireConnectionTimeout: value.acquireConnectionTimeout }
        : {})
    })
  }

  throw unsupportedClientError(client)
}

const getEnvironmentPool = () => {
  const min = process.env.ACTIVITIES_DATABASE_PG_POOL_MIN
    ? parseInt(process.env.ACTIVITIES_DATABASE_PG_POOL_MIN, 10)
    : 1
  const max = process.env.ACTIVITIES_DATABASE_PG_POOL_MAX
    ? parseInt(process.env.ACTIVITIES_DATABASE_PG_POOL_MAX, 10)
    : 5
  const problem = getPoolSizeProblem(min, max)
  if (problem) {
    throw new Error(
      `Invalid ACTIVITIES_DATABASE_PG_POOL_MIN / ACTIVITIES_DATABASE_PG_POOL_MAX: ` +
        `the pool ${problem} (read min ${min}, max ${max})`
    )
  }
  return { min, max }
}

export const getDatabaseConfig = (): { database: DatabaseConfig } | null => {
  if (process.env.ACTIVITIES_DATABASE) {
    return {
      database: parseKnexDatabaseConfig(
        JSON.parse(process.env.ACTIVITIES_DATABASE)
      )
    }
  }

  const hasEnvironmentDatabase = matcher('ACTIVITIES_DATABASE_')
  if (!hasEnvironmentDatabase) return null

  switch (process.env.ACTIVITIES_DATABASE_CLIENT) {
    case 'better-sqlite3': {
      return {
        database: {
          client: process.env.ACTIVITIES_DATABASE_CLIENT,
          useNullAsDefault: true,
          connection: {
            filename:
              process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME || ':memory:'
          }
        }
      }
    }
    case 'pg': {
      return {
        database: {
          client: process.env.ACTIVITIES_DATABASE_CLIENT,
          connection: {
            application_name: 'Activities.next',
            ...(process.env.ACTIVITIES_DATABASE_PG_HOST
              ? { host: process.env.ACTIVITIES_DATABASE_PG_HOST }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_PG_PORT
              ? { port: parseInt(process.env.ACTIVITIES_DATABASE_PG_PORT, 10) }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_PG_USER
              ? { user: process.env.ACTIVITIES_DATABASE_PG_USER }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_PG_PASSWORD
              ? { password: process.env.ACTIVITIES_DATABASE_PG_PASSWORD }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_PG_DATABASE
              ? { database: process.env.ACTIVITIES_DATABASE_PG_DATABASE }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_PG_SSL_MODE &&
            process.env.ACTIVITIES_DATABASE_PG_SSL_MODE !== 'disable'
              ? {
                  ssl: {
                    rejectUnauthorized:
                      process.env.ACTIVITIES_DATABASE_PG_SSL_MODE ===
                        'verify-ca' ||
                      process.env.ACTIVITIES_DATABASE_PG_SSL_MODE ===
                        'verify-full',
                    ...(process.env.ACTIVITIES_DATABASE_PG_SSL_MODE ===
                    'verify-ca'
                      ? { checkServerIdentity: () => undefined }
                      : {})
                  }
                }
              : {})
          },
          pool: getEnvironmentPool()
        }
      }
    }
    default: {
      // An unset client is "not configured"; a client that is set but is not
      // one of the two supported ones must fail here with a message that
      // names them, instead of a bare missing-database error.
      if (process.env.ACTIVITIES_DATABASE_CLIENT) {
        throw unsupportedClientError(process.env.ACTIVITIES_DATABASE_CLIENT)
      }
      return null
    }
  }
}
