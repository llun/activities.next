import knex from 'knex'

import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'
import * as migration from '@/migrations/20260808000000_add_public_ids'

describe('public ids migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.datetime('createdAt')
    })
    await database.schema.createTable('actors', (table) => {
      table.string('id')
      table.datetime('createdAt')
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('runs without a wrapping transaction', () => {
    expect(migration.config).toEqual({ transaction: false })
  })

  it('backfills v7 publicIds whose timestamps match createdAt', async () => {
    const older = Date.UTC(2020, 0, 1)
    const newer = Date.UTC(2023, 5, 15)
    await database('statuses').insert([
      { id: 'https://llun.test/users/a/statuses/1', createdAt: older },
      { id: 'https://llun.test/users/a/statuses/2', createdAt: newer }
    ])
    await database('actors').insert([
      { id: 'https://llun.test/users/a', createdAt: older }
    ])

    await migration.up(database)

    const statuses = await database('statuses')
      .select('id', 'publicId', 'createdAt')
      .orderBy('createdAt', 'asc')
    for (const row of statuses) {
      expect(isPublicId(row.publicId)).toBe(true)
      expect(getPublicIdTimestamp(row.publicId)).toBe(row.createdAt)
    }
    // lexicographic order == chronological order
    expect(statuses[0].publicId < statuses[1].publicId).toBe(true)

    const [actor] = await database('actors').select('publicId')
    expect(isPublicId(actor.publicId)).toBe(true)
  })

  it('is idempotent and preserves existing publicIds on re-run', async () => {
    await database('statuses').insert([
      {
        id: 'https://llun.test/users/a/statuses/1',
        createdAt: Date.UTC(2021, 0, 1)
      }
    ])
    await migration.up(database)
    const [first] = await database('statuses').select('publicId')
    await migration.up(database)
    const [second] = await database('statuses').select('publicId')
    expect(second.publicId).toBe(first.publicId)
  })

  it('handles SQLite CURRENT_TIMESTAMP string values', async () => {
    await database('statuses').insert([
      {
        id: 'https://llun.test/users/a/statuses/s',
        createdAt: '2024-03-04 05:06:07'
      }
    ])
    await migration.up(database)
    const [row] = await database('statuses').select('publicId')
    expect(getPublicIdTimestamp(row.publicId)).toBe(
      Date.UTC(2024, 2, 4, 5, 6, 7)
    )
  })

  it('creates the missing unique index on a re-run after an interrupted first run', async () => {
    // Simulates a process interruption between the column-add and index-add
    // statements: the column exists (with a value already backfilled by the
    // interrupted run) but the unique index does not.
    await database('statuses').insert([
      {
        id: 'https://llun.test/users/a/statuses/1',
        createdAt: Date.UTC(2022, 3, 1)
      }
    ])
    await database.schema.alterTable('statuses', (table) => {
      table.string('publicId', 36).nullable()
    })
    const partialPublicId = 'not-yet-backfilled-marker'
    await database('statuses').update({ publicId: partialPublicId })

    await expect(
      database.raw("PRAGMA index_list('statuses')")
    ).resolves.not.toContainEqual(
      expect.objectContaining({ name: 'statuses_publicid_unique' })
    )

    await migration.up(database)

    const indexes = await database.raw("PRAGMA index_list('statuses')")
    expect(indexes).toContainEqual(
      expect.objectContaining({ name: 'statuses_publicid_unique' })
    )
    // Re-running up() must not touch a row that already has a (non-v7, in
    // this test) publicId value — only the missing schema object is added.
    const [row] = await database('statuses').select('publicId')
    expect(row.publicId).toBe(partialPublicId)

    // The unique index is now actually enforced.
    await database('statuses').insert([
      {
        id: 'https://llun.test/users/a/statuses/2',
        createdAt: Date.UTC(2022, 3, 2)
      }
    ])
    await expect(
      database('statuses')
        .where('id', 'https://llun.test/users/a/statuses/2')
        .update({ publicId: partialPublicId })
    ).rejects.toThrow()
  })

  it('rolls back cleanly', async () => {
    await migration.up(database)
    await migration.down(database)
    await expect(
      database.schema.hasColumn('statuses', 'publicId')
    ).resolves.toBe(false)
    await expect(database.schema.hasColumn('actors', 'publicId')).resolves.toBe(
      false
    )
  })
})
