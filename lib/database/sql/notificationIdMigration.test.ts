import knex from 'knex'

import { rewriteNotificationIds } from '@/lib/database/sql/notificationIdRewrite.js'
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
  const base = Date.UTC(2025, 0, 1)

  // Deterministic v4-shaped ids that all sort BELOW the v7 prefix of a
  // 2025 timestamp (019…), so a rewritten row lands ahead of the walk's cursor
  // and is read again. Index 0 is the newest, so v4 string order is the reverse
  // of creation order.
  const lowV4Id = (index: number) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  // batchInsert keeps each INSERT under SQLite's 500-term compound SELECT cap.
  const seedLowV4Rows = (count: number) =>
    database.batchInsert(
      'notifications',
      Array.from({ length: count }, (_, index) => ({
        id: lowV4Id(index),
        actorId,
        createdAt: base + (count - index) * 1000
      })),
      100
    )
  const createdAtOf = async (id: string) =>
    (await database('notifications').select('createdAt').where('id', id))[0]
      ?.createdAt
  const idCreatedAt = async (createdAt: number) =>
    (await database('notifications').select('id').where({ createdAt }))[0]?.id

  const expectAllTimeOrdered = async (count: number) => {
    const rows = await database('notifications')
      .select('id', 'createdAt')
      .orderBy('createdAt', 'asc')
      // Ties within one millisecond are broken by id, like the server's page order.
      .orderBy('id', 'asc')
    expect(rows).toHaveLength(count)
    for (const row of rows) {
      expect(isPublicId(row.id)).toBe(true)
      expect(getPublicIdTimestamp(row.id)).toBe(row.createdAt)
    }
    const ids = rows.map((row) => row.id)
    expect([...ids].sort()).toEqual(ids)
  }

  it('runs without a wrapping transaction', () => {
    expect(migration.config).toEqual({ transaction: false })
  })

  it('rewrites v4 ids across several batches and repoints only the notifications marker', async () => {
    // More rows than one walk batch (500) and one UPDATE chunk (200), mixing
    // low-sorting deterministic ids with random ones, plus a row that is
    // already v7 and must keep its id.
    await seedLowV4Rows(1100)
    await database('notifications').insert(
      Array.from({ length: 100 }, (_, index) => ({
        id: crypto.randomUUID(),
        actorId,
        createdAt: base + (2000 + index) * 1000
      }))
    )
    const existingV7 = '01941f32-a3c0-74b2-b8ec-7b3759269e5b'
    await database('notifications').insert({
      id: existingV7,
      actorId,
      createdAt: getPublicIdTimestamp(existingV7)
    })
    const markedId = lowV4Id(700)
    const markedCreatedAt = await createdAtOf(markedId)
    await database('markers').insert([
      {
        id: 'marker-notifications',
        actorId,
        timeline: 'notifications',
        lastReadId: markedId
      },
      // A home marker holds a status id; it must never be rewritten, even if
      // the value happens to equal a notification id.
      { id: 'marker-home', actorId, timeline: 'home', lastReadId: markedId }
    ])

    await migration.up(database)

    await expectAllTimeOrdered(1201)
    await expect(
      database('notifications').where('id', existingV7).count({ cnt: '*' })
    ).resolves.toEqual([{ cnt: 1 }])
    const markers = await database('markers')
      .select('timeline', 'lastReadId')
      .orderBy('timeline')
    expect(markers).toEqual([
      { timeline: 'home', lastReadId: markedId },
      {
        timeline: 'notifications',
        lastReadId: await idCreatedAt(markedCreatedAt)
      }
    ])
  })

  it('re-reads rewritten rows that move ahead of the cursor and skips them', async () => {
    await seedLowV4Rows(600)

    const result = await rewriteNotificationIds(database)

    // The first batch's rows move above the cursor once rewritten, so the walk
    // reads them again (scanned > rows) and skips them as already v7: each row
    // is still rewritten exactly once.
    expect(result.scanned).toBeGreaterThan(600)
    expect(result).toMatchObject({ pending: 600, rewritten: 600, markers: 0 })
    await expectAllTimeOrdered(600)
  })

  it('resumes after an interruption, keeping each chunk and its marker together', async () => {
    await seedLowV4Rows(1000)
    // The first walk batch is ids 0..499 in string order, rewritten in chunks
    // of 200, 200 and 100. One marker names a row in the first chunk, the
    // other a row in the third, which the interruption below rolls back.
    const firstChunkCreatedAt = await createdAtOf(lowV4Id(10))
    const thirdChunkCreatedAt = await createdAtOf(lowV4Id(450))
    await database('markers').insert([
      {
        id: 'marker-a',
        actorId,
        timeline: 'notifications',
        lastReadId: lowV4Id(10)
      },
      {
        id: 'marker-b',
        actorId: 'https://llun.test/users/b',
        timeline: 'notifications',
        lastReadId: lowV4Id(450)
      }
    ])
    // Fails the 401st rewritten row, i.e. inside the third chunk.
    await database.raw('CREATE TABLE trip (n integer)')
    await database.raw('INSERT INTO trip (n) VALUES (0)')
    await database.raw(`
      CREATE TRIGGER interrupt_rewrite
      AFTER UPDATE OF "id" ON "notifications"
      BEGIN
        UPDATE trip SET n = n + 1;
        SELECT RAISE(ABORT, 'interrupted') WHERE (SELECT n FROM trip) > 400;
      END;
    `)

    await expect(migration.up(database)).rejects.toThrow('interrupted')

    const rows = await database('notifications').select('id')
    expect(rows.filter((row) => isPublicId(row.id))).toHaveLength(400)
    const markersAfterFailure = await database('markers')
      .select('id', 'lastReadId')
      .orderBy('id')
    expect(markersAfterFailure).toEqual([
      { id: 'marker-a', lastReadId: await idCreatedAt(firstChunkCreatedAt) },
      { id: 'marker-b', lastReadId: lowV4Id(450) }
    ])

    await database.raw('DROP TRIGGER interrupt_rewrite')
    await migration.up(database)

    await expectAllTimeOrdered(1000)
    const markers = await database('markers')
      .select('id', 'lastReadId')
      .orderBy('id')
    expect(markers).toEqual([
      { id: 'marker-a', lastReadId: await idCreatedAt(firstChunkCreatedAt) },
      { id: 'marker-b', lastReadId: await idCreatedAt(thirdChunkCreatedAt) }
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
