import { sql } from 'kysely'

import {
  getInstanceActivity as getInstanceActivityFromCounters,
  recordWeeklyLoginSafely
} from '@/lib/database/domains/instanceActivity/queries'
import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import type { CaptureQueries } from '@/lib/database/testing/queryCapture'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import { logger } from '@/lib/utils/logger'

const toUnixSeconds = (date: Date) => Math.floor(date.getTime() / 1000)

describe('instance activity counters', () => {
  let testDb: TestDatabase
  let db: TestDatabase['db']
  let captureQueries: CaptureQueries

  // An empty in-memory SQLite database (the schema dump is never loaded) with
  // only the counters table, so the rows below can hold timestamp text.
  beforeEach(async () => {
    testDb = createTestDatabase({ backend: 'sqlite' })
    db = testDb.db
    captureQueries = testDb.captureQueries

    await db.schema
      .createTable('counters')
      .addColumn('id', 'varchar(255)', (column) => column.primaryKey())
      .addColumn('value', 'integer', (column) => column.defaultTo(0))
      .addColumn('bucketHour', 'datetime')
      .addColumn('createdAt', 'datetime')
      .addColumn('updatedAt', 'datetime')
      .execute()
  })

  afterEach(async () => {
    await testDb.destroy()
  })

  it('groups SQLite timestamp strings without timezone as UTC', async () => {
    await withTimeZone('Europe/Amsterdam', async () => {
      // Raw text, which a typed insert would not take (it writes a Date).
      await sql`
        insert into counters (id, value, "bucketHour", "createdAt", "updatedAt")
        values (
          'bucket:local-statuses:2026052500',
          1,
          '2026-05-25 00:30:00.000',
          '2026-05-25 00:30:00.000',
          '2026-05-25 00:30:00.000'
        )
      `.execute(db)

      const activity = await getInstanceActivityFromCounters(db, {
        now: new Date('2026-05-26T12:00:00.000Z')
      })

      expect(activity[0]).toMatchObject({
        week: String(toUnixSeconds(new Date('2026-05-25T00:00:00.000Z'))),
        statuses: '1'
      })
      expect(activity[1]).toMatchObject({
        week: String(toUnixSeconds(new Date('2026-05-18T00:00:00.000Z'))),
        statuses: '0'
      })
    })
  })

  it('filters bucket rows by sortable counter id range in the database query', async () => {
    const queries = await captureQueries(() =>
      getInstanceActivityFromCounters(db, {
        now: new Date('2026-05-26T12:00:00.000Z')
      })
    )

    const countersQuery = queries.find((query) =>
      query.sql.includes('from "counters"')
    )

    expect(countersQuery?.sql).toContain('"id" >= ?')
    expect(countersQuery?.sql).toContain('"id" < ?')
    expect(countersQuery?.sql).not.toContain('"bucketHour" >= ?')
    expect(countersQuery?.sql).not.toContain('"bucketHour" < ?')
    expect(countersQuery?.bindings).toEqual(
      expect.arrayContaining([
        'bucket:local-statuses:2026030900',
        'bucket:local-statuses:2026060100',
        'bucket:logins:2026030900',
        'bucket:logins:2026060100',
        'bucket:accounts:2026030900',
        'bucket:accounts:2026060100'
      ])
    )
  })

  it('logs weekly login recording failures with structured logger metadata', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined)

    try {
      await db.schema.dropTable('counters').execute()
      await recordWeeklyLoginSafely(
        db,
        'account-log-error',
        new Date('2026-02-04T10:00:00.000Z')
      )

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ code: 'SQLITE_ERROR' }),
          accountId: 'account-log-error'
        }),
        'Failed to record weekly login'
      )
    } finally {
      loggerErrorSpy.mockRestore()
    }
  })
})
