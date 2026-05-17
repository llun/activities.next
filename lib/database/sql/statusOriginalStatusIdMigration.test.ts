import knex from 'knex'

import * as migration from '@/migrations/20260517000000_add_status_original_status_id'

describe('status original status id migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.string('type')
      table.string('actorId')
      table.text('content')
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  test('adds and backfills indexed announce original status ids', async () => {
    await database('statuses').insert([
      {
        id: 'announce-string',
        type: 'Announce',
        actorId: 'actor-1',
        content: 'original-1'
      },
      {
        id: 'announce-json',
        type: 'Announce',
        actorId: 'actor-1',
        content: JSON.stringify({ url: 'original-2' })
      },
      {
        id: 'note',
        type: 'Note',
        actorId: 'actor-1',
        content: JSON.stringify({ text: 'hello' })
      }
    ])

    await migration.up(database)

    await expect(
      database.schema.hasColumn('statuses', 'originalStatusId')
    ).resolves.toBe(true)
    await expect(
      database('statuses').select('id', 'originalStatusId').orderBy('id', 'asc')
    ).resolves.toEqual([
      { id: 'announce-json', originalStatusId: 'original-2' },
      { id: 'announce-string', originalStatusId: 'original-1' },
      { id: 'note', originalStatusId: null }
    ])

    const indexes = await database.raw("PRAGMA index_list('statuses')")
    expect(
      (indexes as Array<{ name: string }>).some(
        ({ name }) => name === 'statuses_announce_actor_original_idx'
      )
    ).toBe(true)
  })

  test('removes the original status id column on rollback', async () => {
    await migration.up(database)
    await migration.down(database)

    await expect(
      database.schema.hasColumn('statuses', 'originalStatusId')
    ).resolves.toBe(false)
  })
})
