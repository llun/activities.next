import type { Db } from '@/lib/database/kysely'
import { getDialectName } from '@/lib/database/kysely/dialect'
import {
  SQLITE_MAX_BINDINGS,
  chunkArray,
  getInsertBatchSize,
  getWhereInBatchSize,
  insertInChunks,
  selectInChunks
} from '@/lib/database/kysely/inList'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { createCompileOnlyDb } from '@/lib/database/testing/compileOnlyDb'
import type { Database } from '@/lib/database/types'

describe('batch sizes', () => {
  // Compiles only: neither instance connects.
  const sqlite = createCompileOnlyDb('sqlite')
  const postgres = createCompileOnlyDb('pg')

  it.each([
    { reserved: 0, size: 999 },
    { reserved: 1, size: 998 },
    { reserved: 7, size: 992 },
    { reserved: 998, size: 1 },
    { reserved: 5000, size: 1 }
  ])(
    'fits an in list with $reserved other bindings into SQLite’s $size',
    ({ reserved, size }) => {
      expect(getWhereInBatchSize(sqlite, reserved)).toBe(size)
      // PostgreSQL takes the default whatever is reserved.
      expect(getWhereInBatchSize(postgres, reserved)).toBe(1000)
    }
  )

  it('uses the default in-list size on PostgreSQL only', () => {
    expect(getWhereInBatchSize(postgres, 0, 250)).toBe(250)
    expect(getWhereInBatchSize(sqlite, 0, 250)).toBe(999)
  })

  it.each([
    { cap: undefined, sqliteRows: 333, postgresRows: 1000 },
    { cap: 250, sqliteRows: 250, postgresRows: 250 },
    { cap: 5000, sqliteRows: 333, postgresRows: 5000 },
    { cap: 0, sqliteRows: 1, postgresRows: 1 },
    { cap: 2.7, sqliteRows: 2, postgresRows: 2 },
    { cap: Number.NaN, sqliteRows: 333, postgresRows: 1000 }
  ])(
    'fits $sqliteRows rows of three columns on SQLite and $postgresRows on PostgreSQL under a cap of $cap',
    ({ cap, sqliteRows, postgresRows }) => {
      const row = { a: 1, b: 2, c: 3 }
      expect(getInsertBatchSize(sqlite, row, cap)).toBe(sqliteRows)
      expect(getInsertBatchSize(postgres, row, cap)).toBe(postgresRows)
    }
  )

  it('counts a row with no columns as one column', () => {
    expect(getInsertBatchSize(sqlite, {})).toBe(999)
    expect(getInsertBatchSize(postgres, {})).toBe(1000)
  })

  it('keeps a SQLite statement within its bind limit and leaves PostgreSQL at 1000', () => {
    const sqliteDb = sqlite
    const postgresDb = postgres
    expect(getWhereInBatchSize(sqliteDb, 1)).toBe(SQLITE_MAX_BINDINGS - 1)
    expect(getWhereInBatchSize(postgresDb, 1)).toBe(1000)
    expect(getInsertBatchSize(sqliteDb, { a: 1, b: 2, c: 3 })).toBe(
      Math.floor(SQLITE_MAX_BINDINGS / 3)
    )
    expect(getInsertBatchSize(postgresDb, { a: 1, b: 2, c: 3 })).toBe(1000)
  })
})

describe('chunkArray', () => {
  it('splits into chunks of the size, the last one shorter', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]])
    expect(chunkArray([], 3)).toEqual([])
  })

  it('floors the size and takes at least one', () => {
    expect(chunkArray([1, 2, 3], 2.9)).toEqual([[1, 2], [3]])
    expect(chunkArray([1, 2], 0)).toEqual([[1], [2]])
    expect(chunkArray([1, 2], -3)).toEqual([[1], [2]])
  })

  it('keeps every item in one chunk for a size that is not finite', () => {
    expect(chunkArray([1, 2, 3], Number.NaN)).toEqual([[1, 2, 3]])
    expect(chunkArray([1, 2, 3], Number.POSITIVE_INFINITY)).toEqual([[1, 2, 3]])
  })
})

// Real statements on SQLite and, under TEST_DATABASE_TYPE=pg, PostgreSQL.
describe('chunked statements', () => {
  const ACTOR = 'https://example.com/users/in-list'
  const total = 2500

  let database: Database
  let db: Db
  let statements: { sql: string; bindings: unknown[] }[] = []

  beforeAll(async () => {
    const test = getTestDatabaseWithInstance()
    database = test.database
    db = test.db
    await test.prepare()
    await database.migrate()
    test.onQuery(({ sql, bindings }) => {
      statements.push({ sql, bindings })
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    statements = []
  })

  const targets = Array.from({ length: total }, (_, i) => `target-${i}`)
  const isSqlite = () => getDialectName(db) === 'sqlite'
  const statementsOf = (verb: RegExp) =>
    statements.filter((statement) => verb.test(statement.sql))

  it('inserts every row, in as few statements as the backend allows', async () => {
    const createdAt = new Date()
    await insertInChunks(
      db,
      targets.map((targetActorId) => ({
        actorId: ACTOR,
        targetActorId,
        createdAt
      })),
      (chunk) => db.insertInto('suggestion_dismissals').values(chunk).execute()
    )

    const inserts = statementsOf(/^insert into "suggestion_dismissals"/)
    // Three columns: 333 rows fit SQLite's 999 bindings, PostgreSQL takes 1000.
    expect(inserts).toHaveLength(isSqlite() ? Math.ceil(total / 333) : 3)
    for (const insert of inserts) {
      expect(insert.bindings.length).toBeLessThanOrEqual(
        isSqlite() ? SQLITE_MAX_BINDINGS : 3000
      )
    }
    const stored = await db
      .selectFrom('suggestion_dismissals')
      .select(({ fn }) => fn.countAll().as('count'))
      .where('actorId', '=', ACTOR)
      .executeTakeFirstOrThrow()
    expect(Number(stored.count)).toBe(total)
  })

  it('selects every value across chunks, in chunk order', async () => {
    const reversed = [...targets].reverse()
    // The query binds the actor id as well, so one binding is reserved.
    const rows = await selectInChunks(
      db,
      reversed,
      (chunk) =>
        db
          .selectFrom('suggestion_dismissals')
          .select('targetActorId')
          .where('actorId', '=', ACTOR)
          .where('targetActorId', 'in', chunk)
          .execute(),
      1
    )

    expect(new Set(rows.map((row) => row.targetActorId)).size).toBe(total)
    expect(rows).toHaveLength(total)
    const chunkSize = isSqlite() ? SQLITE_MAX_BINDINGS - 1 : 1000
    const selects = statementsOf(/^select .* from "suggestion_dismissals"/)
    expect(selects).toHaveLength(Math.ceil(total / chunkSize))
    for (const select of selects) {
      expect(select.bindings.length).toBeLessThanOrEqual(
        isSqlite() ? SQLITE_MAX_BINDINGS : chunkSize + 1
      )
    }
    // Chunks run in input order: the first chunk's rows are the first values.
    expect(
      new Set(rows.slice(0, chunkSize).map((row) => row.targetActorId))
    ).toEqual(new Set(reversed.slice(0, chunkSize)))
  })

  it('issues no statement for no values', async () => {
    const selected = await selectInChunks(db, [], () =>
      Promise.reject(new Error('not expected'))
    )
    await insertInChunks(db, [], () =>
      Promise.reject(new Error('not expected'))
    )

    expect(selected).toEqual([])
    expect(statements).toEqual([])
  })
})
