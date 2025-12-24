import { noop } from 'lodash'
import { Client as PostgresClient } from 'pg'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

const TEST_PG_TABLE = 'test'
const TEST_PG_CONNECTION = {
  host: process.env.TEST_DATABASE_HOST,
  port: 5432,
  user: process.env.TEST_DATABASE_USERNAME,
  password: process.env.TEST_DATABASE_PASSWORD
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
    case 'pg': {
      const { name, database, prepare } =
        DATABASES[process.env.TEST_DATABASE_TYPE]()
      return [[name, database, prepare]]
    }
    default: {
      const sqlite = DATABASES.sqlite()
      return [[sqlite.name, sqlite.database, sqlite.prepare]]
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

export const getTestSQLDatabase = () =>
  getSQLDatabase({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
