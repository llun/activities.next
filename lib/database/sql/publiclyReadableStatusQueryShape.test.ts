import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Guards the SHAPE of the publicly-readable predicate, not its results.
//
// `getActorStatuses({ publicOnly: true })` — the signed-out profile page and
// the ActivityPub outbox page — used to attach readability as
// `id IN (<recursive CTE over the actor's entire history>)`. That subquery is
// uncorrelated, so the planner has to finish it before `LIMIT` sees a single
// row: on a PostgreSQL 18 seed shaped like production it cost 33,308-33,311
// buffers and ~23ms for a 30-row page, at every page size, growing forever with
// the actor's history. The correlated predicate reads 476 buffers and 0.63ms
// for the same page.
//
// `publiclyReadableStatusEquivalence.test.ts` proves the two forms select the
// same rows — which is exactly why this file has to exist. Every result-based
// assertion in the suite passes against the slow one, so a revert to
// `whereIn(id, buildPubliclyReadableStatusIdsQuery(…))` lands silently and
// green unless something looks at the SQL itself.
//
// Capturing knex's `query` event follows the precedent in
// `localPublicQueryShape.test.ts`: it observes what the production path
// actually sends, rather than a builder the test constructed for itself.
describe('publicly readable status query shape', () => {
  const { database, instance, prepare } = getTestDatabaseWithInstance()

  const actorId = 'https://llun.test/users/shape'

  // Identifier quoting is per-dialect — backticks on SQLite, double quotes on
  // PostgreSQL — so strip it and let the assertions describe the shape rather
  // than whichever backend the suite is running against.
  const normalize = (sql: string) =>
    sql.replaceAll('`', '').replaceAll('"', '').toLowerCase()

  const capture = async (run: () => Promise<unknown>): Promise<string[]> => {
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
    return statements
  }

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await database.createActor({
      actorId,
      username: 'shape',
      domain: 'llun.test',
      publicKey: 'publicKey-shape',
      privateKey: 'privateKey-shape',
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      followersUrl: `${actorId}/followers`,
      createdAt: Date.now()
    })
    await database.createNote({
      id: `${actorId}/statuses/1`,
      url: `${actorId}/statuses/1`,
      actorId,
      text: 'shape',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('filters the public actor status page with a correlated predicate', async () => {
    const statements = await capture(() =>
      database.getActorStatuses({ actorId, publicOnly: true, limit: 30 })
    )

    const matches = statements.filter((sql) => sql.includes('announce_chain'))
    expect(matches).toHaveLength(1)
    const sql = matches[0]

    // Correlated to the row the outer query is already looking at. Both halves
    // matter: the recipient test and the announce chain each reference
    // `statuses` from inside their subquery.
    expect(sql).toContain('recipients.statusid = statuses.id')
    expect(sql).toContain(
      'case when statuses.type = ' +
        "'announce' then coalesce(statuses.originalstatusid, statuses.content) end"
    )

    // The bound has to reach the database, not just the result set. This is
    // the whole point: with the set form present, LIMIT bounded nothing.
    expect(sql).toContain('limit')

    // A cycle terminates because the recursion dedupes. UNION ALL does not
    // fail this suite if it returns — it hangs it.
    expect(sql).toContain(' union ')
    expect(sql).not.toContain(' union all ')

    // The materialised id set must be gone from the page query entirely — not
    // merely joined differently.
    expect(sql).not.toContain('publicly_readable_statuses')
    expect(
      statements.some((s) => s.includes('publicly_readable_statuses'))
    ).toBe(false)
  })

  it('inlines the Announce literal in the chain pointer rather than binding it', async () => {
    // knex emits a UNION'd CTE term's FROM bindings before its select-list
    // bindings, so a bound `?` in the chain-pointer CASE can swap with another
    // value in the same term. `announceOriginalPointer` escapes the literal to
    // sidestep that, and both readability forms share it. A captured statement
    // shows bound values as placeholders, so seeing the literal here is the
    // proof it was never bound.
    const statements = await capture(() =>
      database.getActorStatuses({ actorId, publicOnly: true, limit: 30 })
    )
    const sql = statements.filter((s) => s.includes('announce_chain'))[0]

    expect(sql).toContain("= 'announce' then coalesce(")
  })

  // Two call sites deliberately keep the set-based readable-id form, for two
  // different measured reasons, and both are pinned here so "finishing the
  // unification" has to delete an assertion that explains why not. Neither is
  // visible to a result-based test: the two forms select identical rows.
  it.each([
    {
      description: 'the public status count',
      // A COUNT has to touch every row anyway, and the correlated form costs
      // one recursive-CTE instantiation per Announce: on the production-shaped
      // seed it read 40% fewer buffers and still took three times as long
      // (54ms against 18ms). Reasoning at `getActorStatusesCount`.
      run: () => database.getActorStatusesCount({ actorId, publicOnly: true })
    },
    {
      description: 'the anonymous reblogged-by list',
      // Shipped correlated on this branch and caught in review, which is why
      // it is pinned. Reasoning and measurements at `getRebloggedBy` in
      // `status.ts`.
      run: () => database.getRebloggedBy({ statusId: `${actorId}/statuses/1` })
    }
  ])(
    'keeps the set-based readable-id form for $description',
    async ({ run }) => {
      const statements = await capture(run)

      const matches = statements.filter((sql) =>
        sql.includes('publicly_readable_statuses')
      )
      expect(matches).toHaveLength(1)
      expect(matches.every((sql) => !sql.includes('announce_chain'))).toBe(true)
      expect(statements.some((sql) => sql.includes('announce_chain'))).toBe(
        false
      )
    }
  )
})
