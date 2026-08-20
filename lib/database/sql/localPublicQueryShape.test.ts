import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { Timeline } from '@/lib/services/timelines/types'

// Guards the SHAPE of the local public timeline query, not its results.
//
// The semi-join in `localPublicStatusesQuery` is the entire performance fix:
// it is what lets `LIMIT` bound the scan. Rewriting it back to
// `innerJoin('recipients', …).distinct()` is behaviourally identical for every
// other assertion in the suite — the counts stay right and the duplicate
// regression test still passes, because DISTINCT dedupes too — while restoring
// the plan that had this query at ~27s on the landing page. Without a test that
// looks at the SQL itself, that revert lands silently and green.
//
// Capturing knex's `query` event follows the precedent in `status.test.ts`
// (the batched-hydration tests). It is preferred over asserting on a builder's
// `toSQL()` here because it observes what the production path actually sends,
// rather than a builder the test constructed for itself.
//
// Built on `getTestDatabaseWithInstance` rather than the SQLite-only
// `getTestSQLDatabaseWithInstance`, because the query this pins is a
// PostgreSQL fix and `testUtils` is explicit that the SQLite-only helpers
// report a clean run under the pg environment variables without ever opening a
// PostgreSQL connection.
describe('local public timeline query shape', () => {
  const { database, instance, prepare } = getTestDatabaseWithInstance()

  // Identifier quoting is per-dialect — backticks on SQLite, double quotes on
  // PostgreSQL — so strip it and let the assertions describe the query shape
  // rather than whichever backend the suite is running against. Bound values
  // can never appear here: knex emits `?`/`$n` placeholders and passes the
  // values separately.
  const normalize = (sql: string) => sql.replaceAll('`', '').replaceAll('"', '')

  // Capture what actually reaches the driver, so this tracks the query the
  // production path builds rather than a helper exported for the test's sake.
  const captureLocalPublicQuery = async (
    run: () => Promise<unknown>
  ): Promise<string> => {
    const statements: string[] = []
    const listener = ({ sql }: { sql: string }) => {
      statements.push(normalize(sql))
    }
    instance.on('query', listener)
    try {
      await run()
    } finally {
      instance.off('query', listener)
    }

    // Selected rather than assumed to be the only one: hydrating a status
    // issues its own `recipients` reads, so a future seeded row here would
    // otherwise turn a shape regression into a confusing "expected 1, got 3".
    // Deliberately matched on both table names and not on which one is in the
    // FROM — a revert puts `recipients` there — so that a regression fails on
    // the assertion that names it rather than on finding no statement at all.
    // The hydration reads mention only `recipients` (their column is
    // `statusId`, not `statuses`), so they never match.
    const matches = statements.filter(
      (sql) => sql.includes('recipients') && sql.includes('statuses')
    )
    expect(matches).toHaveLength(1)
    return matches[0]
  }

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it.each([
    {
      description: 'the LOCAL_PUBLIC feed',
      run: () =>
        database.getTimeline({ timeline: Timeline.LOCAL_PUBLIC, limit: 20 })
    },
    {
      description: 'the landing page threshold count',
      run: () => database.getLocalPublicStatusesCount(100)
    }
  ])(
    'reads recipients as a semi-join with no DISTINCT for $description',
    async ({ run }) => {
      const sql = await captureLocalPublicQuery(run)

      // A semi-join: correlated EXISTS rather than a row-multiplying join.
      expect(sql).toContain('exists (')
      expect(sql).toContain('recipients.statusId = statuses.id')
      expect(sql).not.toContain('inner join recipients')

      // DISTINCT is what made the LIMIT unable to stop early. The semi-join
      // makes it unnecessary, and its return would mean the fix was undone.
      expect(sql).not.toContain('distinct')

      // The bound has to reach the database, not just the result set.
      expect(sql).toContain('limit')
    }
  )
})
