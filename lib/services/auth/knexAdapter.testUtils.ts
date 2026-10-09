import knex, { Knex } from 'knex'

import { knexAdapter } from './knexAdapter'

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
  createdAt: string
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

export type TestAdapter = ReturnType<ReturnType<typeof knexAdapter>>

/** An in-memory SQLite database with the tables the adapter suites share. */
export const createTestDatabase = async () => {
  const db = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })

  await db.schema.createTable('users', (table) => {
    table.text('id').primary()
    table.text('display_name')
    table.text('email').unique()
    table.boolean('email_verified').defaultTo(false)
    table.timestamp('created_at')
    table.timestamp('updated_at')
    // Named like the real `accounts.createdAt` so the `At`-suffix hydration
    // rule applies to it when this table is the joined side of a join.
    table.timestamp('createdAt')
  })

  await db.schema.createTable('accounts', (table) => {
    table.text('id').primary()
    table.text('user_id').references('id').inTable('users')
    table.text('provider')
    table.text('provider_account_id')
    table.text('password')
  })

  await db.schema.createTable('sessions', (table) => {
    table.text('id').primary()
    table.text('user_id').references('id').inTable('users')
    table.text('accountId')
    table.text('token').unique()
    table.timestamp('expires_at')
    table.timestamp('createdAt')
    table.timestamp('expireAt')
  })

  await db.schema.createTable('session', (table) => {
    table.text('id').primary()
    table.text('user_id').references('id').inTable('users')
    table.text('accountId')
    table.text('token').unique()
    table.timestamp('expires_at')
    table.timestamp('createdAt')
    table.timestamp('expireAt')
  })

  await db.schema.createTable('counters', (table) => {
    table.string('id').primary()
    table.integer('value').defaultTo(0)
    table.timestamp('bucketHour', { useTz: true }).nullable()
    table.timestamp('createdAt', { useTz: true })
    table.timestamp('updatedAt', { useTz: true })
  })

  await db.schema.createTable('passkey', (table) => {
    table.string('id').primary()
    table.string('userId')
    table.string('rpID').nullable()
  })

  // The mock createAdapterFactory above uses identity getModelName/getFieldName.
  // This means table names = model names and field names are used as-is,
  // which lets us test the raw adapter CRUD logic and where-clause operators.
  const factory = knexAdapter(db)
  const adapter = factory({} as any)

  return { db, adapter }
}

/** Empties every table, so each test starts from a clean database. */
export const resetTables = async (db: Knex) => {
  await db('counters').delete()
  await db('session').delete()
  await db('sessions').delete()
  await db('accounts').delete()
  await db('users').delete()
  await db('passkey').delete()
}
