import { noop } from 'lodash'
import { Client as PostgresClient } from 'pg'

import { FirestoreStorage } from '@/lib/database/firestore'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

const TEST_PG_TABLE = 'test'
const TEST_PG_CONNECTION = {
  host: 'localhost',
  port: 5432,
  user: 'admin',
  password: 'password'
}

export type PrepareFunction = () => Promise<void> | void
export type TestDatabaseTableItem = [string, Database, PrepareFunction]
export type TestDatabaseTable = TestDatabaseTableItem[]

type GetTestDatabase = () => {
  name: string
  database: Database
  prepare: () => Promise<void> | void
}

const DATABASES: Record<string, GetTestDatabase> = {
  sqlite: () => ({
    name: 'sqlite',
    database: getSQLDatabase({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    }),
    prepare: noop
  }),
  firestore: () => ({
    name: 'firestore',
    database: new FirestoreStorage({
      type: 'firebase',
      projectId: 'test',
      host: 'localhost:8080',
      ssl: false
    }),
    prepare: noop
  }),
  pg: () => ({
    name: 'pg',
    database: getSQLDatabase({
      client: 'pg',
      connection: {
        ...TEST_PG_CONNECTION,
        database: TEST_PG_TABLE
      }
    }),
    prepare: async () => {
      const client = new PostgresClient({
        ...TEST_PG_CONNECTION,
        database: 'postgres'
      })
      await client.connect()
      await client.query(
        `DROP DATABASE IF EXISTS ${TEST_PG_TABLE} WITH (FORCE)`
      )
      await client.query(`CREATE DATABASE ${TEST_PG_TABLE}`)
      await client.end()
    }
  })
}

export const getTestDatabaseTable = (): TestDatabaseTable => {
  switch (process.env.TEST_DATABASE_TYPE) {
    case 'sqlite':
    case 'firestore':
    case 'pg': {
      const { name, database, prepare } =
        DATABASES[process.env.TEST_DATABASE_TYPE]()
      return [[name, database, prepare]]
    }
    default: {
      const sqlite = DATABASES.sqlite()
      const firestore = DATABASES.firestore()
      return [
        [sqlite.name, sqlite.database, sqlite.prepare],
        // Enable this when run start:firestore emulator and clear the database manually
        [firestore.name, firestore.database, firestore.prepare]
      ]
    }
  }
}

export const databaseBeforeAll = async (table: TestDatabaseTable) => {
  await Promise.all(
    table.map(async (item) => {
      const [, database, prepare] = item
      await prepare()
      await database.migrate()
    })
  )
}
