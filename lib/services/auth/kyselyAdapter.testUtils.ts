import {
  type CreateTestDatabaseOptions,
  type TestDatabase,
  type TestDatabaseBackend,
  createTestDatabase as createBackendDatabase
} from '@/lib/database/testing/createTestDatabase'

import { type AuthKysely, kyselyAdapter } from './kyselyAdapter'

export type UserRow = {
  id: string
  display_name: string
  email: string
}

export type SessionDateRow = {
  createdAt: Date
  expireAt: Date
}

export type SessionInvalidDateRow = {
  createdAt: number
  expireAt: Date
}

export type SessionRow = {
  id: string
  user_id: string | null
  token: string
}

export type UserWithSessions = UserRow & {
  sessions: SessionRow[]
}

export type SessionWithAccount = SessionRow & {
  accounts: {
    id: string
    user_id: string
    provider: string
  } | null
}

export type TestAdapter = ReturnType<ReturnType<typeof kyselyAdapter>>

/** The column type of the timestamp columns on each backend. */
export const timestampType = (backend: TestDatabaseBackend) =>
  backend === 'pg' ? 'timestamptz' : 'datetime'

// Shaped like the real `counters` table the weekly-login hook writes to.
export const createCountersTable = (
  db: AuthKysely,
  backend: TestDatabaseBackend
) =>
  db.schema
    .createTable('counters')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('value', 'bigint', (column) => column.notNull().defaultTo(0))
    .addColumn('bucketHour', timestampType(backend))
    .addColumn('createdAt', timestampType(backend))
    .addColumn('updatedAt', timestampType(backend))
    .execute()

/**
 * A fresh database on the suite's backend (`TEST_DATABASE_TYPE`) with the
 * tables the adapter suites share, and the adapter over it. `isolated` gives a
 * second database on PostgreSQL for a suite that needs one alongside.
 */
export const createTestDatabase = async (
  options: Pick<CreateTestDatabaseOptions, 'isolated'> = {}
): Promise<{ testDb: TestDatabase; db: AuthKysely; adapter: TestAdapter }> => {
  const testDb = createBackendDatabase(options)
  // The suite creates its own tables on the empty database, so `prepare`'s
  // dump schema would collide with them.
  await testDb.prepareEmpty()
  const db = testDb.db as unknown as AuthKysely
  const timestamp = timestampType(testDb.backend)

  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('display_name', 'text')
    .addColumn('email', 'text', (column) => column.unique())
    .addColumn('email_verified', 'boolean', (column) => column.defaultTo(false))
    .addColumn('created_at', timestamp)
    .addColumn('updated_at', timestamp)
    // Named like the real `accounts.createdAt`, and typed `date` in the test
    // schema, so it is hydrated when this table is the joined side of a join.
    .addColumn('createdAt', timestamp)
    .execute()

  // Absent from the test schema (see kyselyAdapter.testFactory.ts). `email`
  // is the column the adapter lowercases.
  await db.schema
    .createTable('accounts')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('user_id', 'text', (column) => column.references('users.id'))
    .addColumn('provider', 'text')
    .addColumn('provider_account_id', 'text')
    .addColumn('password', 'text')
    .addColumn('email', 'text', (column) => column.unique())
    .addColumn('name', 'text')
    .execute()

  for (const table of ['sessions', 'session']) {
    await db.schema
      .createTable(table)
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('user_id', 'text', (column) => column.references('users.id'))
      .addColumn('accountId', 'text')
      .addColumn('token', 'text', (column) => column.unique())
      .addColumn('expires_at', timestamp)
      .addColumn('createdAt', timestamp)
      .addColumn('expireAt', timestamp)
      .execute()
  }

  // The real tables' `sessionId` foreign keys have no ON DELETE action, which
  // is what makes a plain session delete fail once a token points at it.
  for (const table of ['oauthAccessToken', 'oauthRefreshToken']) {
    await db.schema
      .createTable(table)
      .addColumn('id', 'text', (column) => column.primaryKey())
      .addColumn('sessionId', 'text', (column) =>
        column.references('sessions.id')
      )
      .execute()
  }

  await createCountersTable(db, testDb.backend)

  await db.schema
    .createTable('passkey')
    .addColumn('id', 'varchar(255)', (column) => column.primaryKey())
    .addColumn('userId', 'varchar(255)')
    .addColumn('rpID', 'varchar(255)')
    .execute()

  await db.schema
    .createTable('tokens')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('revoked', timestamp)
    .addColumn('issuedAt', 'text')
    .execute()

  // The mocked createAdapterFactory uses identity getModelName/getFieldName.
  // This means table names = model names and field names are used as-is,
  // which lets us test the raw adapter CRUD logic and where-clause operators.
  const adapter = kyselyAdapter(db)({} as any)

  return { testDb, db, adapter }
}

/** Empties every table, so each test starts from a clean database. */
export const resetTables = async (db: AuthKysely) => {
  for (const table of [
    'oauthAccessToken',
    'oauthRefreshToken',
    'counters',
    'session',
    'sessions',
    'accounts',
    'users',
    'passkey',
    'tokens'
  ]) {
    await db.deleteFrom(table).execute()
  }
}
