import { Settings as FirestoreSetting } from '@google-cloud/firestore'
import { Knex } from 'knex'
import { z } from 'zod'

import { matcher } from './utils'

export const KnexDatabaseType = z.union([
  z.literal('sqlite3'),
  z.literal('sql'),
  z.literal('knex')
])
export type KnexDatabaseType = z.infer<typeof KnexDatabaseType>

export const KnexBaseDatabase = z.looseObject({
  type: KnexDatabaseType
})
export type KnexBaseDatabase = Knex.Config & z.infer<typeof KnexBaseDatabase>

export const FirebaseDatabaseType = z.union([
  z.literal('firebase'),
  z.literal('firestore')
])
export type FirebaseDatabaseType = z.infer<typeof FirebaseDatabaseType>

export const FirebaseDatabase = z.looseObject({
  type: FirebaseDatabaseType
})
export type FirebaseDatabase = FirestoreSetting &
  z.infer<typeof FirebaseDatabase>

export const DatabaseConfig = z.union([KnexBaseDatabase, FirebaseDatabase])
export type DatabaseConfig = z.infer<typeof DatabaseConfig>

export const getDatabaseConfig = (): { database: DatabaseConfig } | null => {
  if (process.env.ACTIVITIES_DATABASE) {
    return { database: JSON.parse(process.env.ACTIVITIES_DATABASE) }
  }

  const hasEnvironmentDatabase = matcher('ACTIVITIES_DATABASE_')
  if (!hasEnvironmentDatabase) return null

  switch (process.env.ACTIVITIES_DATABASE_TYPE) {
    case 'sqlite3':
    case 'sql':
    case 'knex': {
      switch (process.env.ACTIVITIES_DATABASE_CLIENT) {
        case 'better-sqlite3':
        case 'sqlite3': {
          return {
            database: {
              type: process.env.ACTIVITIES_DATABASE_TYPE,
              client: process.env.ACTIVITIES_DATABASE_CLIENT,
              useNullAsDefault: true,
              connection: {
                filename: process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME
              }
            }
          }
        }
        case 'pg-native':
        case 'pg': {
          return {
            database: {
              type: process.env.ACTIVITIES_DATABASE_TYPE,
              client: process.env.ACTIVITIES_DATABASE_CLIENT,
              connection: {
                application_name: 'Activities.next',
                ...(process.env.ACTIVITIES_DATABASE_PG_HOST
                  ? { host: process.env.ACTIVITIES_DATABASE_PG_HOST }
                  : {}),
                ...(process.env.ACTIVITIES_DATABASE_PG_PORT
                  ? { port: process.env.ACTIVITIES_DATABASE_PG_PORT }
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
                min: process.env.ACTIVITIES_DATABASE_PG_POOL_MIN ?? 1,
                max: process.env.ACTIVITIES_DATABASE_PG_POOL_MAX ?? 1
              }
            }
          }
        }
        case 'mysql':
        case 'mysql2': {
          return {
            database: {
              type: process.env.ACTIVITIES_DATABASE_TYPE,
              client: process.env.ACTIVITIES_DATABASE_CLIENT,
              connection: {
                ...(process.env.ACTIVITIES_DATABASE_MYSQL_HOST
                  ? { host: process.env.ACTIVITIES_DATABASE_MYSQL_HOST }
                  : {}),
                ...(process.env.ACTIVITIES_DATABASE_MYSQL_PORT
                  ? { port: process.env.ACTIVITIES_DATABASE_MYSQL_PORT }
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
                min: process.env.ACTIVITIES_DATABASE_MYSQL_POOL_MIN ?? 1,
                max: process.env.ACTIVITIES_DATABASE_MYSQL_POOL_MAX ?? 1
              }
            }
          }
        }
        default: {
          return null
        }
      }
    }
    case 'firebase':
    case 'firestore': {
      return {
        database: {
          type: process.env.ACTIVITIES_DATABASE_TYPE,
          apiKey: process.env.FIREBASE_API_KEY,
          authDomain: process.env.FIREBASE_AUTH_DOMAIN,
          projectId: process.env.FIREBASE_PROJECT_ID,
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
          messageSenderId: process.env.FIREBASE_MESSAGE_SENDER_ID,
          appId: process.env.FIREBASE_APP_ID,
          measurementId: process.env.FIREBASE_MEASUREMENT_ID,
          credentials: {
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            private_key: process.env.FIREBASE_PRIVATE_KEY
          }
        }
      }
    }
    default: {
      return null
    }
  }
}
