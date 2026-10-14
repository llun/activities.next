import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// What every column category reads back as, on SQLite and, under
// TEST_DATABASE_TYPE=pg, PostgreSQL. The expected values are pinned, so a
// change here is a change in what the app serialises.
//
// Every value is pinned with its JavaScript type: `toStrictEqual` tells 42
// from '42', 1 from true, and a parsed object from its JSON text.
describe('read normalisation', () => {
  const testDb = createTestDatabase()
  const { db } = testDb
  const pg = testDb.backend === 'pg'

  const at = new Date('2026-01-02T03:04:05.678Z')
  const atMs = at.getTime()
  // 2026-01-02 03:04:05 UTC, as SQLite's CURRENT_TIMESTAMP writes it.
  const textTimestampMs = Date.UTC(2026, 0, 2, 3, 4, 5)
  let before = 0
  let after = 0

  // A CURRENT_TIMESTAMP default is the time of the insert: pin its type and
  // range, then compare it as 'now'.
  const now = (value: unknown) => {
    expect(typeof value).toBe('number')
    // SQLite's CURRENT_TIMESTAMP has whole seconds.
    expect(value as number).toBeGreaterThanOrEqual(
      Math.floor(before / 1000) * 1000
    )
    expect(value as number).toBeLessThanOrEqual(after)
    return 'now'
  }

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()

    before = Date.now()
    // One row per insert: a multi-row insert fills a column one row leaves
    // out with NULL on SQLite instead of its default.
    await db
      .insertInto('counters')
      .values({
        id: 'golden:max-safe',
        value: Number.MAX_SAFE_INTEGER,
        createdAt: at,
        updatedAt: at,
        bucketHour: null
      })
      .execute()
    await db
      .insertInto('counters')
      .values({ id: 'golden:defaults', value: 42 })
      .execute()
    // A timestamp written as text (SQLite's CURRENT_TIMESTAMP format) rather
    // than bound as a Date.
    await sql`
      insert into counters (id, value, "createdAt", "updatedAt")
      values (
        'golden:text-timestamp', -7,
        ${pg ? '2026-01-02 03:04:05+00' : '2026-01-02 03:04:05'},
        ${pg ? '2026-01-02T03:04:05.678Z' : atMs}
      )
    `.execute(db)
    await db
      .insertInto('customEmojis')
      .values({
        id: 'golden-emoji-1',
        shortcode: 'golden_one',
        url: 'https://llun.test/one.png',
        staticUrl: 'https://llun.test/one.png',
        category: null,
        disabled: true,
        visibleInPicker: false,
        createdAt: at,
        updatedAt: at
      })
      .execute()
    await db
      .insertInto('customEmojis')
      .values({
        id: 'golden-emoji-2',
        shortcode: 'golden_two',
        url: 'https://llun.test/two.png',
        staticUrl: 'https://llun.test/two.png',
        category: 'Golden'
      })
      .execute()
    await db
      .insertInto('status_history')
      .values({
        statusId: 'golden-status-1',
        data: JSON.stringify({
          text: 'héllo ✓',
          count: 3,
          ratio: 0.5,
          flag: false,
          nested: { list: [1, 'two', null] }
        }),
        createdAt: at,
        updatedAt: at
      })
      .execute()
    await db
      .insertInto('status_history')
      .values({ statusId: 'golden-status-2', data: null, createdAt: at })
      .execute()
    await db
      .insertInto('medias')
      .values({
        actorId: 'https://llun.test/users/golden',
        original: 'golden/original.jpg',
        description: null,
        originalBytes: 5_000_000_000,
        thumbnailBytes: null,
        originalMetaData: JSON.stringify({ width: 4000, height: 3000 }),
        thumbnailMetaData: null,
        focusX: 0.25,
        focusY: -0.5,
        placeLatitude: -33.8688,
        placeLongitude: 151.2093,
        inGallery: true,
        takenAt: at,
        createdAt: at,
        updatedAt: at
      })
      .execute()
    await db
      .insertInto('status_detected_languages')
      .values({
        statusId: 'golden-status-1',
        language: 'en',
        confidence: 0.75,
        createdAt: at,
        updatedAt: at
      })
      .execute()
    await db
      .insertInto('actors')
      .values({ id: 'https://llun.test/users/golden', username: 'golden' })
      .execute()
    await db
      .insertInto('wahoo_history_imports')
      .values({
        id: 'golden-import',
        actorId: 'https://llun.test/users/golden',
        providerUserId: 'wahoo-golden',
        fromDate: '2026-03-04',
        toDate: '2026-03-31'
      })
      .execute()
    after = Date.now()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const readRows = async (on: Db) => ({
    counters: (
      await on
        .selectFrom('counters')
        .select(['id', 'value', 'createdAt', 'updatedAt', 'bucketHour'])
        .where('id', 'like', 'golden:%')
        .orderBy('id')
        .execute()
    ).map((row) =>
      row.id === 'golden:defaults'
        ? {
            ...row,
            createdAt: now(row.createdAt),
            updatedAt: now(row.updatedAt)
          }
        : row
    ),
    customEmojis: (
      await on
        .selectFrom('customEmojis')
        .select([
          'id',
          'category',
          'disabled',
          'visibleInPicker',
          'createdAt',
          'updatedAt'
        ])
        .where('id', 'like', 'golden-emoji-%')
        .orderBy('id')
        .execute()
    ).map((row) =>
      row.id === 'golden-emoji-2'
        ? {
            ...row,
            createdAt: now(row.createdAt),
            updatedAt: now(row.updatedAt)
          }
        : row
    ),
    statusHistory: (
      await on
        .selectFrom('status_history')
        .select(['statusId', 'data', 'createdAt', 'updatedAt'])
        .where('statusId', 'like', 'golden-status-%')
        .orderBy('statusId')
        .execute()
    ).map((row) =>
      row.statusId === 'golden-status-2'
        ? { ...row, updatedAt: now(row.updatedAt) }
        : row
    ),
    medias: await on
      .selectFrom('medias')
      .select([
        'description',
        'originalBytes',
        'thumbnailBytes',
        'originalMetaData',
        'thumbnailMetaData',
        'focusX',
        'focusY',
        'placeLatitude',
        'placeLongitude',
        'inGallery',
        'editVersion',
        'takenAt',
        'createdAt',
        'editedAt'
      ])
      .where('original', '=', 'golden/original.jpg')
      .execute(),
    languages: await on
      .selectFrom('status_detected_languages')
      .select(['language', 'confidence', 'createdAt'])
      .where('statusId', '=', 'golden-status-1')
      .execute(),
    imports: (
      await on
        .selectFrom('wahoo_history_imports')
        .select([
          'fromDate',
          'toDate',
          'nextPage',
          'scanComplete',
          'lastError',
          'createdAt'
        ])
        .where('id', '=', 'golden-import')
        .execute()
    ).map((row) => ({ ...row, createdAt: now(row.createdAt) }))
  })

  const expectedRows = {
    counters: [
      {
        id: 'golden:defaults',
        value: 42,
        createdAt: 'now',
        updatedAt: 'now',
        bucketHour: null
      },
      {
        id: 'golden:max-safe',
        value: Number.MAX_SAFE_INTEGER,
        createdAt: atMs,
        updatedAt: atMs,
        bucketHour: null
      },
      {
        id: 'golden:text-timestamp',
        value: -7,
        createdAt: textTimestampMs,
        updatedAt: atMs,
        bucketHour: null
      }
    ],
    customEmojis: [
      {
        id: 'golden-emoji-1',
        category: null,
        disabled: true,
        visibleInPicker: false,
        createdAt: atMs,
        updatedAt: atMs
      },
      {
        id: 'golden-emoji-2',
        category: 'Golden',
        disabled: false,
        visibleInPicker: true,
        createdAt: 'now',
        updatedAt: 'now'
      }
    ],
    statusHistory: [
      {
        statusId: 'golden-status-1',
        data: {
          text: 'héllo ✓',
          count: 3,
          ratio: 0.5,
          flag: false,
          nested: { list: [1, 'two', null] }
        },
        createdAt: atMs,
        updatedAt: atMs
      },
      {
        statusId: 'golden-status-2',
        data: null,
        createdAt: atMs,
        updatedAt: 'now'
      }
    ],
    medias: [
      {
        description: null,
        originalBytes: 5_000_000_000,
        thumbnailBytes: null,
        originalMetaData: { width: 4000, height: 3000 },
        thumbnailMetaData: null,
        focusX: 0.25,
        focusY: -0.5,
        placeLatitude: -33.8688,
        placeLongitude: 151.2093,
        inGallery: true,
        editVersion: 0,
        takenAt: atMs,
        createdAt: atMs,
        editedAt: null
      }
    ],
    languages: [{ language: 'en', confidence: 0.75, createdAt: atMs }],
    imports: [
      {
        fromDate: '2026-03-04',
        toDate: '2026-03-31',
        nextPage: 1,
        scanComplete: false,
        lastError: null,
        createdAt: 'now'
      }
    ]
  }

  it('reads each column category as one representation on both backends', async () => {
    expect(await readRows(db)).toStrictEqual(expectedRows)
  })

  it('reads the same inside a transaction', async () => {
    const inside = await db.transaction().execute((trx) => readRows(trx))
    expect(inside).toStrictEqual(expectedRows)
  })

  // Expressions have no declared column type on SQLite, so they come back as
  // SQLite produced them; PostgreSQL still parses them by their result type.
  it('reads expression columns by their result type', async () => {
    const { rows } = await sql<Record<string, unknown>>`
      select
        count(*) as "total",
        sum(value) as "sum",
        avg(value) as "average",
        max("createdAt") as "latest",
        min(id) as "firstId"
      from counters
      where id in ('golden:max-safe', 'golden:text-timestamp')
    `.execute(db)
    expect(rows).toStrictEqual([
      {
        total: 2,
        sum: Number.MAX_SAFE_INTEGER - 7,
        average: (Number.MAX_SAFE_INTEGER - 7) / 2,
        // SQLite sorts TEXT after INTEGER, so the text timestamp wins.
        latest: pg ? atMs : '2026-01-02 03:04:05',
        firstId: 'golden:max-safe'
      }
    ])

    const literals = await sql<Record<string, unknown>>`
      select
        ${sql.raw(pg ? 'true' : '1')} as "flag",
        ${sql.raw(pg ? `'{"a":1}'::jsonb` : `'{"a":1}'`)} as "json",
        ${sql.raw(pg ? 'cast(1.5 as numeric)' : '1.5')} as "decimal",
        ${sql.raw(pg ? `date '2026-03-04'` : `'2026-03-04'`)} as "day",
        null as "nothing"
    `.execute(db)
    expect(literals.rows).toStrictEqual([
      {
        flag: pg ? true : 1,
        json: pg ? { a: 1 } : '{"a":1}',
        decimal: 1.5,
        day: '2026-03-04',
        nothing: null
      }
    ])
  })

  it('reports affected rows and insert ids', async () => {
    const inserted = await db
      .insertInto('counters')
      .values({ id: 'golden:affected', value: 1 })
      .executeTakeFirstOrThrow()
    const updated = await db
      .updateTable('counters')
      .set({ value: 2 })
      .where('id', 'in', ['golden:affected', 'golden:defaults'])
      .executeTakeFirstOrThrow()
    const deleted = await db
      .deleteFrom('counters')
      .where('id', '=', 'golden:affected')
      .executeTakeFirstOrThrow()
    const missing = await db
      .deleteFrom('counters')
      .where('id', '=', 'golden:missing')
      .executeTakeFirstOrThrow()

    expect({
      insertedRows: inserted.numInsertedOrUpdatedRows,
      hasInsertId: inserted.insertId !== undefined,
      updatedRows: updated.numUpdatedRows,
      deletedRows: deleted.numDeletedRows,
      missingRows: missing.numDeletedRows
    }).toStrictEqual({
      insertedRows: BigInt(1),
      hasInsertId: !pg,
      updatedRows: BigInt(2),
      deletedRows: BigInt(1),
      missingRows: BigInt(0)
    })
  })

  it('refuses an int8 outside the safe integer range on PostgreSQL', async () => {
    if (!pg) return
    await sql`
      insert into counters (id, value) values ('golden:unsafe', 9007199254740993)
    `.execute(db)
    try {
      await expect(
        db
          .selectFrom('counters')
          .select('value')
          .where('id', '=', 'golden:unsafe')
          .execute()
      ).rejects.toThrow(RangeError)
    } finally {
      await db
        .deleteFrom('counters')
        .where('id', '=', 'golden:unsafe')
        .execute()
    }
  })
})
