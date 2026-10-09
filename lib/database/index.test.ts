import knex from 'knex'

import { assertSupportedDatabaseClient } from '@/lib/database'

describe('assertSupportedDatabaseClient', () => {
  it('accepts better-sqlite3', async () => {
    const db = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    try {
      expect(() => assertSupportedDatabaseClient(db)).not.toThrow()
    } finally {
      await db.destroy()
    }
  })

  it('accepts pg', async () => {
    const db = knex({ client: 'pg', connection: { host: 'localhost' } })
    try {
      expect(() => assertSupportedDatabaseClient(db)).not.toThrow()
    } finally {
      await db.destroy()
    }
  })

  it.each([
    { client: 'mysql2', dialect: 'mysql' },
    { client: 'mysql', dialect: 'mysql' },
    { client: 'sqlite3', dialect: 'sqlite3' },
    { client: 'pgnative', dialect: 'postgresql' }
  ])('throws for the unsupported $client driver', ({ client, dialect }) => {
    const destroy = vi.fn()
    const fake = {
      client: { dialect, driverName: client },
      destroy
    } as unknown as knex.Knex
    expect(() => assertSupportedDatabaseClient(fake)).toThrow(
      /Unsupported database client.*Only better-sqlite3/s
    )
    expect(destroy).toHaveBeenCalled()
  })
})
