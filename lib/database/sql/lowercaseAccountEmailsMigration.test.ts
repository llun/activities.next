import knex, { Knex } from 'knex'

import * as migration from '@/migrations/20260611090000_lowercase_account_emails'

describe('lowercase account emails migration', () => {
  let database: Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await database.schema.createTable('accounts', (table) => {
      table.string('id').primary()
      table.string('email').unique()
      table.string('emailChangePending')
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('lowercases mixed-case email and emailChangePending while leaving canonical rows untouched', async () => {
    await database('accounts').insert([
      {
        id: '1',
        email: 'Alice@Example.com',
        emailChangePending: 'Pending@Example.com'
      },
      { id: '2', email: 'bob@example.com', emailChangePending: null },
      { id: '3', email: '  Carol@Example.COM  ', emailChangePending: null }
    ])

    await migration.up(database)

    const rows = await database('accounts').orderBy('id')
    expect(rows).toEqual([
      {
        id: '1',
        email: 'alice@example.com',
        emailChangePending: 'pending@example.com'
      },
      { id: '2', email: 'bob@example.com', emailChangePending: null },
      { id: '3', email: 'carol@example.com', emailChangePending: null }
    ])
  })

  it('skips rows whose email is null', async () => {
    await database('accounts').insert({
      id: '1',
      email: null,
      emailChangePending: 'Pending@Example.com'
    })

    await migration.up(database)

    const row = await database('accounts').where('id', '1').first()
    expect(row).toEqual({
      id: '1',
      email: null,
      emailChangePending: 'pending@example.com'
    })
  })

  it('normalizes every row across the keyset-pagination chunk boundary', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => {
      const pad = String(i).padStart(4, '0')
      return {
        id: `id-${pad}`,
        // Alternate casing so most rows actually need rewriting.
        email:
          i % 2 === 0 ? `User${pad}@Example.COM` : `user${pad}@example.com`,
        emailChangePending: null
      }
    })
    await database.batchInsert('accounts', rows, 200)

    await migration.up(database)

    const notLowercased = await database('accounts')
      .whereRaw('email <> lower(email)')
      .count<{ count: string | number }>('* as count')
      .first()
    const total = await database('accounts')
      .count<{ count: string | number }>('* as count')
      .first()
    expect(Number(notLowercased?.count ?? 0)).toBe(0)
    expect(Number(total?.count ?? 0)).toBe(1200)
  })

  it('fails loudly and writes nothing when two emails collide once lowercased', async () => {
    await database('accounts').insert([
      { id: '1', email: 'User@Example.com', emailChangePending: null },
      { id: '2', email: 'user@example.com', emailChangePending: null }
    ])

    await expect(migration.up(database)).rejects.toThrow(
      /collide once normalized to lowercase/
    )

    // The error message lists both colliding originals.
    await expect(migration.up(database)).rejects.toThrow(/User@Example\.com/)

    // The transaction rolled back: the mixed-case row is unchanged (not
    // lowercased, not merged/deleted).
    const rows = await database('accounts').orderBy('id')
    expect(rows).toEqual([
      { id: '1', email: 'User@Example.com', emailChangePending: null },
      { id: '2', email: 'user@example.com', emailChangePending: null }
    ])
  })

  it('has an irreversible no-op down that does not throw', async () => {
    await expect(migration.down(database)).resolves.toBeUndefined()
  })
})
