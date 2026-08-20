import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
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
// Asserting on `toSQL()` follows the precedent in `search.test.ts`.
describe('local public timeline query shape', () => {
  const { database, instance } = getTestSQLDatabaseWithInstance()

  // Capture what actually reaches the driver, so this tracks the query the
  // production path builds rather than a helper exported for the test's sake.
  const capture = async (run: () => Promise<unknown>): Promise<string[]> => {
    const statements: string[] = []
    const listener = ({ sql }: { sql: string }) => {
      statements.push(sql)
    }
    instance.on('query', listener)
    try {
      await run()
    } finally {
      instance.off('query', listener)
    }
    return statements
  }

  // Identifier quoting is per-dialect (backticks here, double quotes on
  // PostgreSQL); strip it so the assertions describe the query shape rather
  // than the backend the harness happens to use.
  const recipientsStatement = (statements: string[]) => {
    const matches = statements
      .map((sql) => sql.replaceAll('`', '').replaceAll('"', ''))
      .filter((sql) => sql.includes('recipients'))
    expect(matches).toHaveLength(1)
    return matches[0]
  }

  beforeAll(async () => {
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
      const sql = recipientsStatement(await capture(run))

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
