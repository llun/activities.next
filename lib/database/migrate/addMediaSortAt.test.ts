import { sql } from 'kysely'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { down, up } from '@/migrations/20261024160234_add_media_sort_at'

const testDb = createTestDatabase()

const ACTOR_ID = 'https://llun.test/users/media-sort-at'

const indexExists = async (indexName: string) => {
  if (testDb.backend === 'pg') {
    const { rows } = await sql<{ indexname: string }>`
      select indexname from pg_indexes
      where schemaname = current_schema() and indexname = ${indexName}
    `.execute(testDb.db)
    return rows.length > 0
  }
  const { rows } = await sql<{ name: string }>`
    select name from sqlite_master
    where type = 'index' and name = ${indexName}
  `.execute(testDb.db)
  return rows.length > 0
}

const hasSortAtColumn = async () => {
  const tables = await testDb.db.introspection.getTables()
  const columns = tables.find((table) => table.name === 'medias')?.columns ?? []
  return columns.some((column) => column.name === 'sortAt')
}

describe('20261024160234_add_media_sort_at', () => {
  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('drops sortAt on down, seeds rows, backfills sortAt on up, is idempotent, and drops on down', async () => {
    await down(testDb.db)
    expect(await hasSortAtColumn()).toBe(false)
    expect(await indexExists('medias_actorId_sortAt_id_idx')).toBe(false)

    // a) row with takenAt as Date
    const takenAtA = new Date('2024-03-15T10:00:00.000Z')
    await testDb.db
      .insertInto('medias')
      .values({
        id: 1,
        actorId: ACTOR_ID,
        original: 'a.jpg',
        takenAt: takenAtA,
        createdAt: new Date('2024-01-01T00:00:00.000Z')
      })
      .execute()

    // b) row with no takenAt and createdAt omitted (so SQLite uses default CURRENT_TIMESTAMP text)
    await testDb.db
      .insertInto('medias')
      .values({
        id: 2,
        actorId: ACTOR_ID,
        original: 'b.jpg'
      })
      .execute()

    // c) row with createdAt as Date
    const createdAtC = new Date('2024-06-20T14:30:00.000Z')
    await testDb.db
      .insertInto('medias')
      .values({
        id: 3,
        actorId: ACTOR_ID,
        original: 'c.jpg',
        createdAt: createdAtC
      })
      .execute()

    // d) row with createdAt as ISO text with offset via raw sql (SQLite only, skip on PG)
    const isoTextD = '2024-01-01T12:00:00+02:00'
    if (testDb.backend === 'sqlite') {
      await sql`
        insert into medias (id, "actorId", original, "createdAt")
        values (4, ${ACTOR_ID}, 'd.jpg', ${isoTextD})
      `.execute(testDb.db)
    }

    // Call up(db) to run migration and backfill
    await up(testDb.db)

    // Assert index exists after up(db)
    expect(await indexExists('medias_actorId_sortAt_id_idx')).toBe(true)

    // Query backfilled rows
    const rowA = await testDb.db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'takenAt', 'createdAt'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow()
    expect(rowA.sortAt).toBe(takenAtA.getTime())
    expect(rowA.sortAt).toBe(rowA.takenAt)

    const rowB = await testDb.db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'takenAt', 'createdAt'])
      .where('id', '=', 2)
      .executeTakeFirstOrThrow()
    expect(rowB.sortAt).not.toBeNull()
    expect(rowB.sortAt).toBe(rowB.createdAt)

    const rowC = await testDb.db
      .selectFrom('medias')
      .select(['id', 'sortAt', 'takenAt', 'createdAt'])
      .where('id', '=', 3)
      .executeTakeFirstOrThrow()
    expect(rowC.sortAt).toBe(createdAtC.getTime())
    expect(rowC.sortAt).toBe(rowC.createdAt)

    if (testDb.backend === 'sqlite') {
      const rowD = await testDb.db
        .selectFrom('medias')
        .select(['id', 'sortAt', 'takenAt', 'createdAt'])
        .where('id', '=', 4)
        .executeTakeFirstOrThrow()
      expect(rowD.sortAt).toBe(new Date(isoTextD).getTime())
    }

    // On SQLite, assert select typeof(sortAt) as t from medias returns 'integer' for all rows
    if (testDb.backend === 'sqlite') {
      const { rows: types } = await sql<{ t: string }>`
        select typeof(sortAt) as t from medias
      `.execute(testDb.db)
      expect(types.length).toBe(4)
      for (const { t } of types) {
        expect(t).toBe('integer')
      }
    }

    // Assert calling up(db) a second time is a no-op (safe to run twice)
    await up(testDb.db)

    const rowsAfterSecondUp = await testDb.db
      .selectFrom('medias')
      .select(['id', 'sortAt'])
      .orderBy('id')
      .execute()
    const expectedSortAts = [
      { id: 1, sortAt: takenAtA.getTime() },
      { id: 2, sortAt: rowB.sortAt },
      { id: 3, sortAt: createdAtC.getTime() },
      ...(testDb.backend === 'sqlite'
        ? [{ id: 4, sortAt: new Date(isoTextD).getTime() }]
        : [])
    ]
    expect(rowsAfterSecondUp).toEqual(expectedSortAts)

    // Assert down(db) drops the index and the column sortAt
    await down(testDb.db)
    expect(await indexExists('medias_actorId_sortAt_id_idx')).toBe(false)
    expect(await hasSortAtColumn()).toBe(false)
  })

  // The maintenance script runs `up` again for rows an old build inserted
  // after the migration had already run.
  it('fills a NULL sortAt left behind by an old build when run again', async () => {
    await up(testDb.db)
    await testDb.db
      .insertInto('medias')
      .values({
        id: 10,
        actorId: ACTOR_ID,
        original: 'late.jpg',
        takenAt: new Date('2024-05-05T05:05:05.000Z')
      })
      .execute()
    await testDb.db
      .updateTable('medias')
      .set({ sortAt: null })
      .where('id', '=', 10)
      .execute()

    await up(testDb.db)

    const row = await testDb.db
      .selectFrom('medias')
      .select('sortAt')
      .where('id', '=', 10)
      .executeTakeFirstOrThrow()
    expect(row.sortAt).toBe(new Date('2024-05-05T05:05:05.000Z').getTime())
  })

  // The batch UPDATE runs outside a transaction in the maintenance script, so
  // a date edited between its SELECT and UPDATE must survive.
  it('does not overwrite a sortAt set after the batch was read', async () => {
    await up(testDb.db)
    await testDb.db
      .insertInto('medias')
      .values({
        id: 20,
        actorId: ACTOR_ID,
        original: 'race.jpg',
        takenAt: new Date('2024-01-01T00:00:00.000Z')
      })
      .execute()
    await testDb.db
      .updateTable('medias')
      .set({ sortAt: null })
      .where('id', '=', 20)
      .execute()
    const edited = new Date('2025-02-02T02:02:02.000Z')
    const racing = testDb.db.withPlugin({
      transformQuery: (args) => args.node,
      transformResult: async (args) => {
        // Right after the SELECT returns, "the owner" edits the date.
        if (args.result.rows.some((row) => row.id === 20)) {
          await testDb.db
            .updateTable('medias')
            .set({ sortAt: edited })
            .where('id', '=', 20)
            .execute()
        }
        return args.result
      }
    })

    await up(racing)

    const row = await testDb.db
      .selectFrom('medias')
      .select('sortAt')
      .where('id', '=', 20)
      .executeTakeFirstOrThrow()
    expect(row.sortAt).toBe(edited.getTime())
  })
})
