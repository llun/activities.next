import type { Knex } from 'knex'
import { CompiledQuery } from 'kysely'
import { AsyncResource } from 'node:async_hooks'
import { type MockInstance, expect, onTestFinished, vi } from 'vitest'

import { KnexPoolDriver } from '@/lib/database/kysely/driver'
import { Database } from '@/lib/database/types'

// The pyramid is keyed one-per-actor and the tile assertions are exact
// counts and sums, so every test gets an actor nothing else touches
// rather than sharing one of the seeded ones.
let actorSequence = 0
export const createActor = async (db: Database) => {
  actorSequence += 1
  const username = `tile-actor-${actorSequence}`
  const actorId = `https://llun.test/users/${username}`
  await db.createActor({
    actorId,
    username,
    domain: 'llun.test',
    inboxUrl: `${actorId}/inbox`,
    followersUrl: `${actorId}/followers`,
    sharedInboxUrl: 'https://llun.test/inbox',
    publicKey: `public-key-${username}`,
    privateKey: `private-key-${username}`,
    createdAt: Date.now()
  })
  return actorId
}

// Tile writes are fenced on the build's ownership token, so a test that
// wants to write tiles has to own a build first.
export const claimBuild = async (db: Database, actorId: string) => {
  const claim = await db.claimFitnessRouteHeatmapPyramidBuild({
    actorId,
    requestedAt: Date.now(),
    staleBefore: Date.now() - 120_000
  })
  expect(claim.claimed).toBe(true)
  return claim.pyramid
}

// Every guarded write names the build ROW as well as the token, because
// `claimSeq` restarts at zero when a clear deletes the row.
export const fence = (pyramid: { id: string; claimSeq: number }) => ({
  pyramidId: pyramid.id,
  claimSeq: pyramid.claimSeq
})

/**
 * Asserts that two statements ran inside ONE open transaction on ONE
 * connection.
 *
 * Structural, because what these transactions prevent is a failure between
 * two round trips and there is no seam to inject one at. Order alone is not
 * enough: keeping the `database.transaction(...)` wrapper while building a
 * query on `database` instead of `trx` — the likeliest refactoring slip
 * there is — leaves the order untouched while that statement autocommits on
 * a pooled connection, which is the state these transactions exist to
 * remove. The pool also hands the same connection to unrelated
 * transactions, so "a BEGIN appeared earlier" is not enough either; the one
 * that matters must still be open.
 */
export const expectOneTransaction = (
  statements: Array<{ sql: string; connection: string }>,
  firstMatches: (sql: string) => boolean,
  secondMatches: (sql: string) => boolean
) => {
  // Without this the whole helper degrades to an order-only check the
  // moment knex stops carrying `__knexUid`, which is exactly the weaker
  // assertion it was written to replace.
  for (const statement of statements) {
    expect(typeof statement.connection).toBe('string')
  }

  const firstIndex = statements.findIndex(({ sql }) => firstMatches(sql))
  expect(firstIndex).toBeGreaterThan(-1)
  const secondIndex = statements.findIndex(
    ({ sql }, index) => index > firstIndex && secondMatches(sql)
  )
  expect(secondIndex).toBeGreaterThan(firstIndex)

  const connection = statements[firstIndex].connection
  expect(statements[secondIndex].connection).toBe(connection)

  const onConnection = (index: number) =>
    statements[index].connection === connection
  const opens = (index: number) =>
    onConnection(index) && /^begin/i.test(statements[index].sql)
  const closes = (index: number) =>
    onConnection(index) && /^(commit|rollback)/i.test(statements[index].sql)

  let open = false
  for (let index = 0; index < firstIndex; index += 1) {
    if (opens(index)) open = true
    else if (closes(index)) open = false
  }
  expect(open).toBe(true)

  for (let index = firstIndex; index < secondIndex; index += 1) {
    expect(closes(index)).toBe(false)
  }
}

export const recordStatements = (instance: Knex) => {
  const statements: Array<{ sql: string; connection: string }> = []
  instance.on(
    'query',
    ({ sql, __knexUid }: { sql: string; __knexUid: string }) => {
      statements.push({ sql: sql.trimStart(), connection: __knexUid })
    }
  )
  return statements
}

export const tile = (tileKey: string, pointCount = 4) => {
  const [z, x, y] = tileKey.split(':').map(Number)
  return {
    tileKey,
    z,
    x,
    y,
    segments: `{"e":256,"s":[{"c":1,"p":[0,0,8,8]}],"k":"${tileKey}"}`,
    pointCount
  }
}

type StatementHook = {
  matches: (sql: string) => boolean
  when: 'before' | 'after'
  run: (execute: (query: CompiledQuery) => Promise<unknown>) => Promise<void>
  fired: boolean
}

const statementHooks: StatementHook[] = []
const pendingPauses: Array<() => void> = []
let executeSpy: MockInstance<KnexPoolDriver['execute']> | undefined

/**
 * Runs `hook` once, on the first statement the Kysely driver
 * (`lib/database/kysely/driver.ts`) executes that it matches and no earlier
 * hook has claimed, on that statement's own connection. Every hook is removed,
 * and every pause released, when the test finishes.
 */
const addStatementHook = (hook: Omit<StatementHook, 'fired'>) => {
  statementHooks.push({ ...hook, fired: false })
  if (executeSpy) return

  const execute = KnexPoolDriver.prototype.execute
  const claimHook = (when: StatementHook['when'], sql: string) => {
    const found = statementHooks.find(
      (candidate) =>
        !candidate.fired && candidate.when === when && candidate.matches(sql)
    )
    if (found) found.fired = true
    return found
  }
  executeSpy = vi
    .spyOn(KnexPoolDriver.prototype, 'execute')
    .mockImplementation(async function (
      this: KnexPoolDriver,
      ...[raw, compiledQuery]: Parameters<KnexPoolDriver['execute']>
    ) {
      const run = (query: CompiledQuery) => execute.call(this, raw, query)
      await claimHook('before', compiledQuery.sql)?.run(run)
      const result = await run(compiledQuery)
      await claimHook('after', compiledQuery.sql)?.run(run)
      return result
    } as KnexPoolDriver['execute'])
  onTestFinished(() => {
    statementHooks.length = 0
    for (const release of pendingPauses.splice(0)) release()
    executeSpy?.mockRestore()
    executeSpy = undefined
  })
}

/**
 * Stages another worker's write in the window between two of a facade
 * method's own statements: after the first statement `matches` accepts has
 * run, and before the method sees its result, `interfere` runs on the SAME
 * connection. Fires once.
 *
 * On the connection that just ran the statement, because the Kysely driver
 * still holds it while the statement is announced, and a root Knex query
 * issued from there is refused by the mixed-transaction guard. Running it on
 * that connection also makes the interleaving independent of pool scheduling
 * on PostgreSQL. So it only fits a window OUTSIDE the method's transactions,
 * where the interfering write autocommits as another worker's would; for a
 * window inside one, use `outsideDatabaseContext`.
 *
 * `interfere` returns a Knex query builder, which is compiled, not run: it
 * reads like the other writes these tests stage straight to the columns.
 */
export const interfereAfterStatement = (
  matches: (sql: string) => boolean,
  interfere: () => Knex.QueryBuilder
) => {
  const state = { fired: false }
  addStatementHook({
    matches,
    when: 'after',
    run: async (execute) => {
      state.fired = true
      const { sql, bindings } = interfere().toSQL().toNative()
      await execute(CompiledQuery.raw(sql, [...bindings]))
    }
  })
  return state
}

/**
 * A barrier after the first statement `matches` accepts: the method that
 * issued it stops there, holding its connection and, inside a transaction,
 * every lock the transaction has taken, until `release()`. `reached` resolves
 * once it has stopped.
 */
export const pauseAfterStatement = (matches: (sql: string) => boolean) => {
  let markReached = () => {}
  let release = () => {}
  const reached = new Promise<void>((resolve) => {
    markReached = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  pendingPauses.push(release)
  addStatementHook({
    matches,
    when: 'after',
    run: async () => {
      markReached()
      await released
    }
  })
  return { reached, release }
}

/**
 * Fails the first statement `matches` accepts before it reaches the
 * database, as a statement timeout or a dropped connection would.
 */
export const failStatement = (
  matches: (sql: string) => boolean,
  message = 'forced statement failure'
) => {
  const state = { fired: false }
  addStatementHook({
    matches,
    when: 'before',
    run: async () => {
      state.fired = true
      throw new Error(message)
    }
  })
  return state
}

/**
 * Runs `work` in an async context that holds no database connection: the one
 * this module was loaded in.
 *
 * A Kysely statement is announced on the Knex `query` and `query-response`
 * events from inside the async context that holds its connection, and the
 * mixed-transaction guard refuses a root Knex query there. A listener staging
 * another worker's write has to leave that context, as the other worker was
 * never in it; it then waits for a connection, or on PostgreSQL for the row
 * lock, exactly as that worker would.
 */
export const outsideDatabaseContext = AsyncResource.bind(
  <T>(work: () => Promise<T>): Promise<T> => work()
)
