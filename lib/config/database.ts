import { Knex } from 'knex'

import { matcher } from './utils'

export type DatabaseConfig = Knex.Config

export const getDatabaseConfig = (): { database: DatabaseConfig } | null => {
  if (process.env.ACTIVITIES_DATABASE) {
    return { database: JSON.parse(process.env.ACTIVITIES_DATABASE) }
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
          pool: {
            min: process.env.ACTIVITIES_DATABASE_PG_POOL_MIN
              ? parseInt(process.env.ACTIVITIES_DATABASE_PG_POOL_MIN, 10)
              : 1,
            max: process.env.ACTIVITIES_DATABASE_PG_POOL_MAX
              ? parseInt(process.env.ACTIVITIES_DATABASE_PG_POOL_MAX, 10)
              : 5
          }
        }
      }
    }
    default: {
      // An unset client is "not configured"; a client that is set but is not
      // one of the two supported ones must fail here with a message that
      // names them, instead of a bare missing-database error.
      if (process.env.ACTIVITIES_DATABASE_CLIENT) {
        throw new Error(
          `Unsupported database client "${process.env.ACTIVITIES_DATABASE_CLIENT}": ` +
            'only better-sqlite3 (SQLite) and pg (PostgreSQL) are supported; ' +
            'set ACTIVITIES_DATABASE_CLIENT accordingly (see docs/setup.md).'
        )
      }
      return null
    }
  }
}
