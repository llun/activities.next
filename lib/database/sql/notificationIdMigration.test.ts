import knex from 'knex'

import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'
import * as migration from '@/migrations/20261009163215_time_ordered_notification_ids'

describe('time-ordered notification ids migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('notifications', (table) => {
      table.string('id').primary()
      table.string('actorId').notNullable()
      table.datetime('createdAt')
    })
    await database.schema.createTable('markers', (table) => {
      table.string('id').primary()
      table.string('actorId').notNullable()
      table.string('timeline').notNullable()
      table.text('lastReadId').notNullable()
    })
  })

  afterEach(async () => {
    await database.destroy()
    vi.restoreAllMocks()
  })

  const actorId = 'https://llun.test/users/a'

  it('runs without a wrapping transaction', () => {
    expect(migration.config).toEqual({ transaction: false })
  })

  it('rewrites v4 ids to v7 ids that sort by createdAt and repoints the notifications marker', async () => {
    // More rows than one UPDATE chunk, with v4 ids whose string order is the
    // reverse of their creation order.
    const base = Date.UTC(2025, 0, 1)
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: crypto.randomUUID(),
      actorId,
      createdAt: base + index * 1000
    }))
    await database('notifications').insert(rows)
    const markedId = rows[120].id
    await database('markers').insert([
      {
        id: 'marker-notifications',
        actorId,
        timeline: 'notifications',
        lastReadId: markedId
      },
      // A home marker holds a status id; it must never be rewritten, even if
      // the value happens to equal a notification id.
      {
        id: 'marker-home',
        actorId,
        timeline: 'home',
        lastReadId: markedId
      }
    ])

    await migration.up(database)

    const migrated = await database('notifications')
      .select('id', 'createdAt')
      .orderBy('createdAt', 'asc')
    expect(migrated).toHaveLength(rows.length)
    for (const row of migrated) {
      expect(isPublicId(row.id)).toBe(true)
      expect(getPublicIdTimestamp(row.id)).toBe(row.createdAt)
    }
    const ids = migrated.map((row) => row.id)
    expect([...ids].sort()).toEqual(ids)

    const markers = await database('markers')
      .select('timeline', 'lastReadId')
      .orderBy('timeline')
    expect(markers).toEqual([
      { timeline: 'home', lastReadId: markedId },
      {
        timeline: 'notifications',
        lastReadId: migrated.find(
          (row) => row.createdAt === rows[120].createdAt
        )?.id
      }
    ])
  })

  it('leaves v7 ids alone, so a re-run is a no-op', async () => {
    await database('notifications').insert([
      { id: crypto.randomUUID(), actorId, createdAt: Date.UTC(2024, 1, 1) }
    ])
    await migration.up(database)
    const [first] = await database('notifications').select('id')

    await migration.up(database)
    const [second] = await database('notifications').select('id')

    expect(second.id).toBe(first.id)
  })

  it('reads SQLite CURRENT_TIMESTAMP strings as UTC', async () => {
    await database('notifications').insert([
      { id: crypto.randomUUID(), actorId, createdAt: '2024-03-04 05:06:07' }
    ])

    await migration.up(database)

    const [row] = await database('notifications').select('id')
    expect(getPublicIdTimestamp(row.id)).toBe(Date.UTC(2024, 2, 4, 5, 6, 7))
  })
})
