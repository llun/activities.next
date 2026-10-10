import knexFactory, { type Knex } from 'knex'

import { type Db, kyselyFor } from '@/lib/database/kysely'
import { getDialectName } from '@/lib/database/kysely/dialect'
import {
  getInsertBatchSize,
  getWhereInBatchSize,
  insertInChunks,
  selectInChunks
} from '@/lib/database/kysely/inList'
import {
  SQLITE_MAX_BINDINGS,
  getInsertBatchSize as getKnexInsertBatchSize,
  getWhereInBatchSize as getKnexWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'

describe('batch sizes', () => {
  // Compiles only: neither instance connects.
  const sqlite = knexFactory({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const postgres = knexFactory({ client: 'pg', connection: {} })

  afterAll(async () => {
    await Promise.all([sqlite.destroy(), postgres.destroy()])
  })

  it.each([
    { name: 'sqlite', instance: sqlite },
    { name: 'postgres', instance: postgres }
  ])('match the Knex helpers ($name)', ({ instance }) => {
    const db = kyselyFor(instance)
    const row = { a: 1, b: 2, c: 3 }
    for (const reserved of [0, 1, 7, 998, 5000]) {
      expect(getWhereInBatchSize(db, reserved)).toBe(
        getKnexWhereInBatchSize(instance, reserved)
      )
    }
    expect(getWhereInBatchSize(db, 0, 250)).toBe(
      getKnexWhereInBatchSize(instance, 0, 250)
    )
    for (const cap of [undefined, 250, 5000, 0, 2.7, Number.NaN]) {
      expect(getInsertBatchSize(db, row, cap)).toBe(
        getKnexInsertBatchSize(instance, row, cap)
      )
    }
    expect(getInsertBatchSize(db, {})).toBe(
      getKnexInsertBatchSize(instance, {})
    )
  })

  it('keeps a SQLite statement within its bind limit and leaves PostgreSQL at 1000', () => {
    const sqliteDb = kyselyFor(sqlite)
    const postgresDb = kyselyFor(postgres)
    expect(getWhereInBatchSize(sqliteDb, 1)).toBe(SQLITE_MAX_BINDINGS - 1)
    expect(getWhereInBatchSize(postgresDb, 1)).toBe(1000)
    expect(getInsertBatchSize(sqliteDb, { a: 1, b: 2, c: 3 })).toBe(
      Math.floor(SQLITE_MAX_BINDINGS / 3)
    )
    expect(getInsertBatchSize(postgresDb, { a: 1, b: 2, c: 3 })).toBe(1000)
  })
})

// Real statements on SQLite and, under TEST_DATABASE_TYPE=pg, PostgreSQL.
describe('chunked statements', () => {
  const ACTOR = 'https://example.com/users/in-list'
  const total = 2500

  let database: Database
  let instance: Knex
  let db: Db
  let statements: { sql: string; bindings: unknown[] }[] = []

  beforeAll(async () => {
    const test = getTestDatabaseWithInstance()
    database = test.database
    instance = test.instance
    await test.prepare()
    await database.migrate()
    db = kyselyFor(instance)
    instance.on('query', (query: { sql: string; bindings: unknown[] }) => {
      statements.push({ sql: query.sql, bindings: query.bindings })
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
