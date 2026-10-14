import {
  type DatabaseConfig,
  getPostgresSslSettings,
  parseDatabaseJsonConfig
} from './database'

// The database `yarn migrate` (scripts/database/migrate.ts) runs on. It reads
// the same `ACTIVITIES_DATABASE` JSON and `ACTIVITIES_DATABASE_*` variables as
// the app (getDatabaseConfig in database.ts), with the migration CLI's
// conveniences on top: a bare `ACTIVITIES_DATABASE_SQLITE_FILENAME` means
// SQLite, the generic `ACTIVITIES_DATABASE_HOST` / `_PORT` / `_USER` /
// `_PASSWORD` stand in for the `_PG_` ones, and with nothing set it is
// `ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME` or `./activities.sqlite`.

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// ACTIVITIES_DATABASE_PG_SSL_MODE as node-postgres `ssl` settings, read the
// way the app reads it (getPostgresSslSettings in database.ts).
const getPostgresSslConfig = () =>
  getPostgresSslSettings(process.env.ACTIVITIES_DATABASE_PG_SSL_MODE)

// ACTIVITIES_DATABASE holds the whole configuration as a JSON object and wins
// over the individual ACTIVITIES_DATABASE_* variables, as it does for the app
// (getDatabaseConfig in database.ts). Failing loudly on bad JSON matters:
// falling through would silently migrate the default local SQLite file
// instead of the database the operator configured.
const getJsonDatabaseConfig = (): Record<string, unknown> | null => {
  const raw = process.env.ACTIVITIES_DATABASE
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('ACTIVITIES_DATABASE must be a JSON database configuration')
  }
  if (!isObject(parsed)) {
    throw new Error('ACTIVITIES_DATABASE must be a JSON database configuration')
  }
  return parsed
}

/**
 * The configuration `yarn migrate` reads from the environment, before it is
 * checked: the `ACTIVITIES_DATABASE` JSON; else the `ACTIVITIES_DATABASE_*`
 * variables, where a bare `ACTIVITIES_DATABASE_SQLITE_FILENAME` implies
 * SQLite and the generic `ACTIVITIES_DATABASE_HOST` / `_PORT` / `_USER` /
 * `_PASSWORD` stand in for the `_PG_` ones; else
 * `ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME` or `./activities.sqlite`.
 * Settings that are not set are left `undefined` (`ssl`: `null`).
 */
const getMigrationEnvironmentConfig = (): Record<string, unknown> => {
  const jsonConfig = getJsonDatabaseConfig()
  if (jsonConfig) return jsonConfig

  const client =
    process.env.ACTIVITIES_DATABASE_CLIENT ||
    (process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME
      ? 'better-sqlite3'
      : undefined)

  if (
    Object.keys(process.env).some((key) =>
      key.startsWith('ACTIVITIES_DATABASE_')
    )
  ) {
    return {
      client,
      connection: {
        host:
          process.env.ACTIVITIES_DATABASE_PG_HOST ||
          process.env.ACTIVITIES_DATABASE_HOST,
        port:
          process.env.ACTIVITIES_DATABASE_PG_PORT ||
          process.env.ACTIVITIES_DATABASE_PORT,
        user:
          process.env.ACTIVITIES_DATABASE_PG_USER ||
          process.env.ACTIVITIES_DATABASE_USER,
        password:
          process.env.ACTIVITIES_DATABASE_PG_PASSWORD ||
          process.env.ACTIVITIES_DATABASE_PASSWORD,
        database: process.env.ACTIVITIES_DATABASE_PG_DATABASE,
        filename: process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME,
        ssl: getPostgresSslConfig()
      }
    }
  }

  return {
    client: 'better-sqlite3',
    connection: {
      filename:
        process.env.ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME ||
        './activities.sqlite'
    }
  }
}

// The environment configuration leaves every ACTIVITIES_DATABASE_* setting
// that is not set as an undefined (or, for `ssl`, null) key; those are not
// settings, so they are dropped rather than reported as ignored.
const withoutUnsetValues = (config: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(config)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        key === 'connection' && isObject(value)
          ? Object.fromEntries(
              Object.entries(value).filter(
                ([, setting]) => setting !== undefined && setting !== null
              )
            )
          : value
      ])
  )

/**
 * The database `yarn migrate` runs on (see the top of this file). Call after
 * the `.env*` files are loaded.
 */
export const getMigrationDatabaseConfig = (): DatabaseConfig =>
  parseDatabaseJsonConfig(withoutUnsetValues(getMigrationEnvironmentConfig()))
