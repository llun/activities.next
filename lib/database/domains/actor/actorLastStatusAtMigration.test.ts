import knex from 'knex'

import * as migration from '@/migrations/20260709120000_add_actor_last_status_at'

// Exercises the migration's one-shot backfill against pre-existing rows — the
// runtime suite builds test databases from the schema dumps and never runs this
// migration's `up`, so without this the correlated-MAX backfill is uncovered.
describe('actor lastStatusAt migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('actors', (table) => {
      table.string('id').primary()
      table.string('domain')
      table.timestamp('createdAt')
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.string('actorId')
      table.timestamp('createdAt')
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  test('adds lastStatusAt, backfills the per-actor MAX(createdAt), and indexes it', async () => {
    await database('actors').insert([
      { id: 'a1', domain: 'local.test', createdAt: '2026-01-01 00:00:00' },
      { id: 'a2', domain: 'local.test', createdAt: '2026-01-02 00:00:00' },
      // a3 has no statuses and must stay NULL.
      { id: 'a3', domain: 'local.test', createdAt: '2026-01-03 00:00:00' }
    ])
    await database('statuses').insert([
      { id: 's1', actorId: 'a1', createdAt: '2026-03-01 10:00:00' },
      { id: 's2', actorId: 'a1', createdAt: '2026-03-10 09:00:00' },
      { id: 's3', actorId: 'a2', createdAt: '2026-02-01 08:00:00' }
    ])

    await migration.up(database)

    await expect(
      database.schema.hasColumn('actors', 'lastStatusAt')
    ).resolves.toBe(true)
    await expect(
      database('actors').select('id', 'lastStatusAt').orderBy('id', 'asc')
    ).resolves.toEqual([
      { id: 'a1', lastStatusAt: '2026-03-10 09:00:00' },
      { id: 'a2', lastStatusAt: '2026-02-01 08:00:00' },
      { id: 'a3', lastStatusAt: null }
    ])

    const indexes = await database.raw("PRAGMA index_list('actors')")
    expect(
      (indexes as Array<{ name: string }>).some(
        ({ name }) => name === 'actors_domain_last_status_at_idx'
      )
    ).toBe(true)
  })

  test('removes lastStatusAt on rollback', async () => {
    await migration.up(database)
    await migration.down(database)

    await expect(
      database.schema.hasColumn('actors', 'lastStatusAt')
    ).resolves.toBe(false)
  })
})
