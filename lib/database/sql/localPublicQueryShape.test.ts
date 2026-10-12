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
// The query is built with Kysely (lib/database/domains/timeline/localPublic.ts),
// whose driver emits each statement as a `query` event on the Knex client it
// runs on, tagged `kysely: true`. Listening there follows the precedent in
// `statusLookup.test.ts` (the batched-hydration tests) and is preferred over
// compiling a builder here because it observes what the production path
// actually sends, rather than a builder the test constructed for itself. Only
// tagged statements are kept, and of those only the one naming both
// `recipients` and `statuses` (see below), so the status hydration that
// follows, Kysely too, can never be mistaken for the query under test.
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
  // can never appear here: Kysely emits `?`/`$n` placeholders and passes the
  // values separately.
  const normalize = (sql: string) => sql.replaceAll('`', '').replaceAll('"', '')

  // Capture what actually reaches the driver, so this tracks the query the
  // production path builds rather than a helper exported for the test's sake.
  const captureLocalPublicQuery = async (
    run: () => Promise<unknown>
  ): Promise<string> => {
    const statements: string[] = []
    const listener = ({ sql, kysely }: { sql: string; kysely?: true }) => {
      if (kysely) statements.push(normalize(sql))
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

    // Both surfaces resolve the local actors first and return early when there
    // are none, so an empty database issues no timeline query at all and there
    // would be no SQL here to assert on. One local actor is enough to make them
    // build it.
    const actorId = 'https://llun.test/users/query-shape'
    await database.createActor({
      actorId,
      username: 'query-shape',
      domain: 'llun.test',
      publicKey: 'publicKey-query-shape',
      privateKey: 'privateKey-query-shape',
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      followersUrl: `${actorId}/followers`,
      createdAt: Date.now()
    })
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

      // The local-actor test is literal ids, not a join. Joining `actors` on
      // its unique key leaves the planner no statistic for how much an actor
      // posts: on production that under-estimated the eligible rows ~48x and
      // the plan flipped at a page of 24, and on a seed matching production's
      // shape the same join carrying the `<> ''` predicate costs ~16,700
      // buffers at every page size, against 137/142/176 for the literal form
      // at 23/24/30. That revert is invisible to every result-based
      // assertion.
      expect(sql).not.toContain('inner join actors')
      expect(sql).toContain('statuses.actorId in (')

      // The bound has to reach the database, not just the result set.
      expect(sql).toContain('limit')

      // Readability is the correlated predicate, not the set form's
      // `id in (…)`, so the LIMIT still bounds it.
      expect(sql.toLowerCase()).toContain('with recursive announce_chain')
      expect(sql).not.toContain('statuses.id in (')
    }
  )
})
