import knex from 'knex'

import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'
import * as migration from '@/migrations/20260808000000_add_public_ids'

import { backfillTable, mintPublicId, parseArgs } from './backfillPublicIds'

describe('backfillPublicIds parseArgs', () => {
  it('defaults to a live run with the standard batch size', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, batchSize: 500 })
  })

  it('accepts bare, inline, and space-separated boolean flags', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, batchSize: 500 })
    expect(parseArgs(['--dry-run=false'])).toEqual({
      dryRun: false,
      batchSize: 500
    })
    expect(parseArgs(['--dry-run', 'true'])).toEqual({
      dryRun: true,
      batchSize: 500
    })
  })

  it('accepts a batch size inline or space-separated', () => {
    expect(parseArgs(['--batch-size', '50'])).toEqual({
      dryRun: false,
      batchSize: 50
    })
    expect(parseArgs(['--batch-size=50', '--dry-run'])).toEqual({
      dryRun: true,
      batchSize: 50
    })
  })

  it.each([
    { description: 'a non-flag argument', args: ['statuses'] },
    { description: 'an unknown flag', args: ['--tables', 'statuses'] },
    {
      description: 'a boolean that is not true or false',
      args: ['--dry-run', 'maybe']
    },
    { description: 'a zero batch size', args: ['--batch-size', '0'] },
    { description: 'a fractional batch size', args: ['--batch-size', '1.5'] },
    { description: 'a batch size with no value', args: ['--batch-size'] }
  ])('rejects $description', ({ args }) => {
    expect(() => parseArgs(args)).toThrow()
  })
})

describe('backfillPublicIds mintPublicId', () => {
  it.each([
    { description: 'a Date', createdAt: new Date(Date.UTC(2024, 2, 4)) },
    { description: 'epoch milliseconds', createdAt: Date.UTC(2024, 2, 4) },
    {
      description: 'a SQLite naive UTC string',
      createdAt: '2024-03-04 05:06:07'
    },
    { description: 'an ISO string', createdAt: '2024-03-04T05:06:07.000Z' },
    { description: 'an unparseable value', createdAt: 'not-a-date' },
    {
      description: 'a pre-epoch date',
      createdAt: new Date(Date.UTC(1969, 0, 1))
    }
  ])(
    'mints from $description exactly as the migration does',
    async ({ createdAt }) => {
      // The migration is plain ESM JavaScript run by the knex CLI, which resolves
      // no `@/` aliases and compiles no TypeScript, so it cannot import the
      // script's helper and carries its own copy. Comparing the two by the
      // timestamp they encode is what keeps the copies honest: a row the script
      // repairs after the rollout must sort with the rows the migration filled.
      const database = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      })
      try {
        await database.schema.createTable('statuses', (table) => {
          table.string('id').primary()
          table.datetime('createdAt')
        })
        await database.schema.createTable('actors', (table) => {
          table.string('id')
          table.datetime('createdAt')
        })
        await database('statuses').insert([
          { id: 'https://llun.test/users/a/statuses/1', createdAt }
        ])

        vi.spyOn(console, 'log').mockImplementation(() => undefined)
        await migration.up(database)

        const [row] = await database('statuses').select('createdAt', 'publicId')
        const scriptPublicId = mintPublicId(row.createdAt)
        expect(isPublicId(scriptPublicId)).toBe(true)
        expect(getPublicIdTimestamp(scriptPublicId)).toBe(
          getPublicIdTimestamp(row.publicId)
        )
      } finally {
        await database.destroy()
      }
    }
  )

  it('keeps lexicographic order matching chronological order', () => {
    const older = mintPublicId(new Date(Date.UTC(2020, 0, 1)))
    const newer = mintPublicId(new Date(Date.UTC(2023, 5, 15)))
    expect(older < newer).toBe(true)
  })
})

describe('backfillTable', () => {
  let database: knex.Knex

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.datetime('createdAt')
      table.string('publicId', 36).nullable().unique()
    })
    await database.schema.createTable('actors', (table) => {
      table.string('id')
      table.datetime('createdAt')
      table.string('publicId', 36).nullable().unique()
    })
  })

  afterEach(async () => {
    await database.destroy()
  })

  const insertStatuses = (count: number, offset = 0) =>
    database('statuses').insert(
      Array.from({ length: count }, (_, index) => ({
        id: `https://llun.test/users/a/statuses/${String(offset + index).padStart(4, '0')}`,
        createdAt: Date.UTC(2024, 10, 1) + (offset + index) * 60_000
      }))
    )

  it('fills every addressable row with a distinct v7 id matching createdAt', async () => {
    await insertStatuses(120)

    const report = await backfillTable(database, 'statuses', {
      dryRun: false,
      batchSize: 50
    })

    expect(report).toMatchObject({
      table: 'statuses',
      backfilled: 120,
      unaddressable: 0,
      remaining: 0,
      stopReason: null
    })

    const rows = await database('statuses').select('publicId', 'createdAt')
    expect(rows.every((row) => isPublicId(row.publicId))).toBe(true)
    expect(new Set(rows.map((row) => row.publicId)).size).toBe(120)
    for (const row of rows) {
      expect(getPublicIdTimestamp(row.publicId)).toBe(row.createdAt)
    }
  })

  it('backfills in bulk statements instead of one query per row', async () => {
    // The backfill used to issue one UPDATE per row and fan the whole
    // --batch-size out with Promise.all. This script runs on the APP's pool,
    // which caps at ACTIVITIES_DATABASE_PG_POOL_MAX (5 in production, 1 if
    // unset), so the rest queued in tarn and the batch had to drain inside a
    // single 60s acquireConnectionTimeout — the same failure that killed the
    // migration, on a tighter pool.
    const rowCount = 450
    await insertStatuses(rowCount)

    let updateStatements = 0
    let inFlight = 0
    let maxConcurrentQueries = 0
    const onQuery = ({ sql }: { sql: string }) => {
      if (/^update /i.test(sql)) updateStatements += 1
      inFlight += 1
      maxConcurrentQueries = Math.max(maxConcurrentQueries, inFlight)
    }
    const onSettled = () => {
      inFlight -= 1
    }
    database.on('query', onQuery)
    database.on('query-response', onSettled)
    database.on('query-error', onSettled)

    try {
      await backfillTable(database, 'statuses', {
        dryRun: false,
        batchSize: 500
      })
    } finally {
      database.off('query', onQuery)
      database.off('query-response', onSettled)
      database.off('query-error', onSettled)
    }

    // 450 rows fold into three 200-row chunks, so anything near one statement
    // per row means the fan-out is back.
    expect(updateStatements).toBeLessThanOrEqual(5)
    // And nothing is fanned out concurrently: the backfill holds one pooled
    // connection at a time, leaving the rest of the budget to the live app.
    expect(maxConcurrentQueries).toBe(1)

    const missing = await database('statuses')
      .whereNull('publicId')
      .count({ cnt: '*' })
    expect(Number(missing[0].cnt)).toBe(0)
  })

  it('mints ids identical to the migration for the same rows', async () => {
    // The script and the migration carry separate copies of the minting logic
    // (the migration is plain ESM the knex CLI runs with no `@/` aliases), and
    // a row repaired here must be indistinguishable from one the migration
    // filled — same table, same rows, same publicIds.
    const other = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    try {
      await other.schema.createTable('statuses', (table) => {
        table.string('id').primary()
        table.datetime('createdAt')
      })
      await other.schema.createTable('actors', (table) => {
        table.string('id')
        table.datetime('createdAt')
      })
      const rows = Array.from({ length: 30 }, (_, index) => ({
        id: `https://llun.test/users/a/statuses/${String(index).padStart(4, '0')}`,
        createdAt: Date.UTC(2024, 10, 1) + index * 60_000
      }))
      await other('statuses').insert(rows)
      await database('statuses').insert(rows)

      await migration.up(other)
      await backfillTable(database, 'statuses', {
        dryRun: false,
        batchSize: 500
      })

      const fromMigration = await other('statuses')
        .select('id', 'publicId')
        .orderBy('id')
      const fromScript = await database('statuses')
        .select('id', 'publicId')
        .orderBy('id')
      expect(fromScript.map((row) => row.id)).toEqual(
        fromMigration.map((row) => row.id)
      )
      for (const [index, row] of fromScript.entries()) {
        expect(getPublicIdTimestamp(row.publicId)).toBe(
          getPublicIdTimestamp(fromMigration[index].publicId)
        )
      }
    } finally {
      await other.destroy()
    }
  })

  it('skips rows with a null id and reports them as unaddressable', async () => {
    await database('actors').insert([
      { id: null, createdAt: Date.UTC(2024, 9, 1) },
      { id: null, createdAt: Date.UTC(2024, 9, 2) },
      { id: 'https://llun.test/users/a', createdAt: Date.UTC(2024, 9, 3) }
    ])

    const report = await backfillTable(database, 'actors', {
      dryRun: false,
      batchSize: 500
    })

    expect(report).toMatchObject({
      backfilled: 1,
      unaddressable: 2,
      remaining: 0,
      stopReason: null
    })
    const skipped = await database('actors').select('publicId').whereNull('id')
    expect(skipped.every((row) => row.publicId === null)).toBe(true)
  })

  it('stops instead of looping when its UPDATEs take no effect', async () => {
    await insertStatuses(3)
    // RAISE(IGNORE) in a BEFORE UPDATE trigger models an UPDATE that silently
    // changes nothing: the rows stay selectable, so without the no-progress
    // check the pass would re-select them forever.
    await database.raw(`
      CREATE TRIGGER ignore_public_id_writes
      BEFORE UPDATE OF "publicId" ON "statuses"
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `)

    const report = await backfillTable(database, 'statuses', {
      dryRun: false,
      batchSize: 500
    })

    expect(report.backfilled).toBe(0)
    expect(report.remaining).toBe(3)
    expect(report.stopReason).toBe('made no progress on 3 row(s)')
  })

  it('writes nothing in dry-run mode but still reports what is pending', async () => {
    await insertStatuses(10)

    const report = await backfillTable(database, 'statuses', {
      dryRun: true,
      batchSize: 500
    })

    expect(report).toMatchObject({
      backfilled: 0,
      unaddressable: 0,
      remaining: 10,
      stopReason: null
    })
    const missing = await database('statuses')
      .whereNull('publicId')
      .count({ cnt: '*' })
    expect(Number(missing[0].cnt)).toBe(10)
  })
})
