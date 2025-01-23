import { noop } from 'lodash'
import { Client as PostgresClient } from 'pg'

import { FirestoreStorage } from './firestore'
import { PGStorage } from './pg'
import { SqlStorage } from './sql'
import { Storage } from './types'

const TEST_PG_TABLE = 'test'
const TEST_PG_CONNECTION = {
  host: 'localhost',
  port: 5432,
  user: 'admin',
  password: 'password'
}

export type PrepareFunction = () => Promise<void> | void
export type TestStorageTableItem = [string, Storage, PrepareFunction]
export type TestStorageTable = TestStorageTableItem[]

type GetTestStorage = () => {
  name: string
  storage: Storage
  prepare: () => Promise<void> | void
}

const STORAGES: Record<string, GetTestStorage> = {
  sqlite: () => ({
    name: 'sqlite',
    storage: new SqlStorage({
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
    storage: new FirestoreStorage({
      type: 'firebase',
      projectId: 'test',
      host: 'localhost:8080',
      ssl: false
    }),
    prepare: noop
  }),
  pg: () => ({
    name: 'pg',
    storage: new PGStorage({
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

export const getTestStorageTable = (): TestStorageTable => {
  switch (process.env.TEST_DATABASE_TYPE) {
    case 'sqlite':
    case 'firestore':
    case 'pg': {
      const { name, storage, prepare } =
        STORAGES[process.env.TEST_DATABASE_TYPE]()
      return [[name, storage, prepare]]
    }
    default: {
      const sqlite = STORAGES.sqlite()
      const firestore = STORAGES.firestore()
      return [
        [sqlite.name, sqlite.storage, sqlite.prepare],
        // Enable this when run start:firestore emulator and clear the database manually
        [firestore.name, firestore.storage, firestore.prepare]
      ]
    }
  }
}
