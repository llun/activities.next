import { Knex } from 'knex'

import { matcher } from './utils'

export interface FirestoreConfig {
  client: 'firestore'
  projectId: string
  host?: string
  port?: number
  ssl?: boolean
}

export type DatabaseConfig = Knex.Config | FirestoreConfig

export const getDatabaseConfig = (): { database: DatabaseConfig } | null => {
  if (process.env.ACTIVITIES_DATABASE) {
    return { database: JSON.parse(process.env.ACTIVITIES_DATABASE) }
  }

  const hasEnvironmentDatabase = matcher('ACTIVITIES_DATABASE_')
  if (!hasEnvironmentDatabase) return null

  switch (process.env.ACTIVITIES_DATABASE_CLIENT) {
    case 'firestore': {
      return {
        database: {
          client: 'firestore',
          projectId: process.env.ACTIVITIES_DATABASE_FIRESTORE_PROJECT_ID || '',
          host: process.env.ACTIVITIES_DATABASE_FIRESTORE_HOST,
          port: process.env.ACTIVITIES_DATABASE_FIRESTORE_PORT
            ? parseInt(process.env.ACTIVITIES_DATABASE_FIRESTORE_PORT, 10)
            : undefined,
          ssl: process.env.ACTIVITIES_DATABASE_FIRESTORE_SSL === 'true'
        }
      }
    }
    case 'better-sqlite3':
    case 'sqlite3': {
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
    case 'pg-native':
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
            ...(process.env.ACTIVITIES_DATABASE_PG_SSL_MODE
              ? { ssl: { rejectUnauthorized: false } }
              : {})
          },
          pool: {
            min: process.env.ACTIVITIES_DATABASE_PG_POOL_MIN
              ? parseInt(process.env.ACTIVITIES_DATABASE_PG_POOL_MIN, 10)
              : 1,
            max: process.env.ACTIVITIES_DATABASE_PG_POOL_MAX
              ? parseInt(process.env.ACTIVITIES_DATABASE_PG_POOL_MAX, 10)
              : 1
          }
        }
      }
    }
    case 'mysql':
    case 'mysql2': {
      return {
        database: {
          client: process.env.ACTIVITIES_DATABASE_CLIENT,
          connection: {
            ...(process.env.ACTIVITIES_DATABASE_MYSQL_HOST
              ? { host: process.env.ACTIVITIES_DATABASE_MYSQL_HOST }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_MYSQL_PORT
              ? {
                  port: parseInt(process.env.ACTIVITIES_DATABASE_MYSQL_PORT, 10)
                }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_MYSQL_USER
              ? { user: process.env.ACTIVITIES_DATABASE_MYSQL_USER }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_MYSQL_PASSOWRD
              ? { password: process.env.ACTIVITIES_DATABASE_MYSQL_PASSWORD }
              : {}),
            ...(process.env.ACTIVITIES_DATABASE_MYSQL_DATABASE
              ? { database: process.env.ACTIVITIES_DATABASE_MYSQL_DATABASE }
              : {})
          },
          pool: {
            min: process.env.ACTIVITIES_DATABASE_MYSQL_POOL_MIN
              ? parseInt(process.env.ACTIVITIES_DATABASE_MYSQL_POOL_MIN, 10)
              : 1,
            max: process.env.ACTIVITIES_DATABASE_MYSQL_POOL_MAX
              ? parseInt(process.env.ACTIVITIES_DATABASE_MYSQL_POOL_MAX, 10)
              : 1
          }
        }
      }
    }
    default: {
      return null
    }
  }
}
