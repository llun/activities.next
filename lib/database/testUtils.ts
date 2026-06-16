import { Knex } from 'knex'
import knex from 'knex'
import { noop } from 'lodash'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client as PostgresClient } from 'pg'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

// Tests build their schema from the committed reference dumps instead of running
// the Knex migration chain. This keeps the (ESM) migration files out of the test
// runtime entirely and makes per-file database setup dramatically faster. The
// dumps are kept in lockstep with the migrations (see AGENTS.md), so the schema
// is identical to a fully-migrated database.
const SQLITE_SCHEMA_PATH = fileURLToPath(
  new URL('../../migrations/schema.sqlite.sql', import.meta.url)
)
const POSTGRES_SCHEMA_PATH = fileURLToPath(
  new URL('../../migrations/schema.sql', import.meta.url)
)

const applySqliteSchema = async (instance: Knex) => {
  const sql = readFileSync(SQLITE_SCHEMA_PATH, 'utf8')
  const connection = await instance.client.acquireConnection()
  try {
    // better-sqlite3 exposes a synchronous multi-statement `exec`.
    connection.exec(sql)
  } finally {
    await instance.client.releaseConnection(connection)
  }
}

const applyPostgresSchema = async (instance: Knex) => {
  const sql = readFileSync(POSTGRES_SCHEMA_PATH, 'utf8')
  await instance.raw(sql)
}

// Replaces the production `migrate()` (which runs Knex migrations) with a fast
// schema-dump loader for the test database instance.
const withSchemaDumpMigrate = (
  database: Database,
  instance: Knex,
  loader: (instance: Knex) => Promise<void>
): Database => {
  database.migrate = () => loader(instance)
  return database
}

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
  sqlite: () => {
    const instance = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    return {
      name: 'sqlite',
      database: withSchemaDumpMigrate(
        getSQLDatabase(instance),
        instance,
        applySqliteSchema
      ),
      prepare: noop
    }
  },
  pg: () => {
    const instance = knex({
      client: 'pg',
      connection: {
        ...TEST_PG_CONNECTION,
        database: TEST_PG_TABLE
      }
    })
    return {
      name: 'pg',
      database: withSchemaDumpMigrate(
        getSQLDatabase(instance),
        instance,
        applyPostgresSchema
      ),
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
    }
  }
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

export const getTestSQLDatabase = () => {
  const instance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  return withSchemaDumpMigrate(
    getSQLDatabase(instance),
    instance,
    applySqliteSchema
  )
}
