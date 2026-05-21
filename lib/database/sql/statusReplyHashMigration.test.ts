import crypto from 'crypto'
import knex from 'knex'

import * as migration from '@/migrations/20260519000000_add_status_reply_hash'

const getHash = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex')

describe('status reply hash migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.string('reply')
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  test('adds and backfills indexed status reply hashes', async () => {
    await database('statuses').insert([
      {
        id: 'status-with-reply',
        reply: 'https://remote.test/users/alice/statuses/1'
      },
      { id: 'status-without-reply', reply: '' }
    ])

    await migration.up(database)

    await expect(
      database.schema.hasColumn('statuses', 'replyHash')
    ).resolves.toBe(true)
    await expect(
      database('statuses').select('id', 'replyHash').orderBy('id', 'asc')
    ).resolves.toEqual([
      {
        id: 'status-with-reply',
        replyHash: getHash('https://remote.test/users/alice/statuses/1')
      },
      { id: 'status-without-reply', replyHash: null }
    ])

    const indexes = await database.raw("PRAGMA index_list('statuses')")
    expect(
      (indexes as Array<{ name: string }>).some(
        ({ name }) => name === 'statusesReplyHashIndex'
      )
    ).toBe(true)
  })

  test('creates the reply hash index when the column already exists', async () => {
    await database.schema.alterTable('statuses', (table) => {
      table.string('replyHash', 64).nullable()
    })
    await database('statuses').insert({
      id: 'status-with-existing-column',
      reply: 'https://remote.test/users/alice/statuses/2'
    })

    await migration.up(database)

    await expect(
      database('statuses').select('id', 'replyHash')
    ).resolves.toEqual([
      {
        id: 'status-with-existing-column',
        replyHash: getHash('https://remote.test/users/alice/statuses/2')
      }
    ])

    const indexes = await database.raw("PRAGMA index_list('statuses')")
    expect(
      (indexes as Array<{ name: string }>).some(
        ({ name }) => name === 'statusesReplyHashIndex'
      )
    ).toBe(true)
  })

  test('removes status reply hashes on rollback', async () => {
    await migration.up(database)
    await migration.down(database)

    await expect(
      database.schema.hasColumn('statuses', 'replyHash')
    ).resolves.toBe(false)
  })
})
