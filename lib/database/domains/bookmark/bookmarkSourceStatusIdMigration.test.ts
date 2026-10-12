import knex from 'knex'

import * as migration from '@/migrations/20260517001000_add_bookmark_source_status_id'

describe('bookmark source status id migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('bookmarks', (table) => {
      table.bigIncrements('id').primary()
      table.string('actorId').notNullable()
      table.string('statusId').notNullable()
      table.timestamp('createdAt')
      table.timestamp('updatedAt')
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  test('adds and backfills indexed bookmark source status ids', async () => {
    await database('bookmarks').insert({
      actorId: 'actor-1',
      statusId: 'status-1'
    })

    await migration.up(database)

    await expect(
      database.schema.hasColumn('bookmarks', 'sourceStatusId')
    ).resolves.toBe(true)
    await expect(
      database('bookmarks').select('statusId', 'sourceStatusId')
    ).resolves.toEqual([{ statusId: 'status-1', sourceStatusId: 'status-1' }])

    const indexes = await database.raw("PRAGMA index_list('bookmarks')")
    expect(
      (indexes as Array<{ name: string }>).some(
        ({ name }) => name === 'bookmarks_actor_source_status'
      )
    ).toBe(true)
  })

  test('removes the source status id column on rollback', async () => {
    await migration.up(database)
    await migration.down(database)

    await expect(
      database.schema.hasColumn('bookmarks', 'sourceStatusId')
    ).resolves.toBe(false)
  })
})
