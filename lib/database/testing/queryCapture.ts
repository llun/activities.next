import type { Knex } from 'knex'

/** One statement the database driver sent. */
export type CapturedQuery = {
  sql: string
  bindings: unknown[]
}

/**
 * What an `onQuery` listener receives: the statement, plus an opaque id for
 * the database connection that ran it. Two statements ran on the same
 * connection exactly when their `connection` strings are equal, which is how a
 * test tells "inside one open transaction" from "autocommitted on another
 * pooled connection". Do not parse or print it; its format is the driver's.
 */
export type QueryEvent = CapturedQuery & {
  connection: string
}

export type QueryListener = (query: QueryEvent) => void

/**
 * Listens to the statements the driver sends. Returns the function that stops
 * listening. A listener that throws fails the statement that triggered it, the
 * way a driver-side hook would; use that to turn a runaway loop into a failure.
 */
export type OnQuery = (listener: QueryListener) => () => void

/**
 * Runs `work` and returns every statement the driver sent while it ran, in the
 * order they were sent: reads, writes and the `begin` / `commit` / `rollback` /
 * `savepoint` statements of a transaction, from every connection. Nothing sent
 * before `work` starts or after it settles is included, and a capture inside a
 * capture sees its own statements as well as the outer one's. It is a window in
 * time on the whole pool, not on `work`'s async context: a statement another
 * caller sends while `work` runs is captured too.
 *
 * Resolves with the statements once `work` resolves. If `work` throws, the
 * error is rethrown and the statements are lost; capture inside `work` with
 * `onQuery` when a test needs them after a failure.
 */
export type CaptureQueries = (
  work: () => Promise<unknown> | unknown
) => Promise<CapturedQuery[]>

type KnexQueryEvent = {
  sql: string
  bindings?: unknown[]
  __knexUid?: string
}

/**
 * Statement capture over the Knex `query` events. The Kysely driver announces
 * each statement it runs on its Knex client the way a Knex query is, so this
 * sees both.
 *
 * The test database (`createTestDatabase`) is the way tests get this. Call it
 * directly only for a test that builds its own Knex instance, which is how the
 * legacy migration tests run their migration module. Everything past
 * `onQuery` and `captureQueries` below is for those tests alone and goes away
 * with them.
 *
 * Nothing touches `knex` until the first `onQuery`, so it can be built around
 * a mocked Knex instance.
 */
export const createKnexQueryCapture = (
  knex: Knex
): {
  onQuery: OnQuery
  captureQueries: CaptureQueries
  /**
   * Like `onQuery`, but called when a statement has finished: the listener
   * gets no statement text, only the signal. Pairs a statement's start with
   * its end to measure concurrency. Legacy migration tests only.
   */
  onQuerySettled: (listener: () => void) => () => void
} => {
  const onQuery: OnQuery = (listener) => {
    const handler = ({ sql, bindings, __knexUid }: KnexQueryEvent) => {
      listener({
        sql,
        bindings: [...(bindings ?? [])],
        connection: __knexUid as string
      })
    }
    knex.on('query', handler)
    return () => {
      knex.removeListener('query', handler)
    }
  }

  const captureQueries: CaptureQueries = async (work) => {
    const captured: CapturedQuery[] = []
    const unsubscribe = onQuery(({ sql, bindings }) => {
      captured.push({ sql, bindings })
    })
    try {
      await work()
    } finally {
      unsubscribe()
    }
    return captured
  }

  const onQuerySettled = (listener: () => void) => {
    knex.on('query-response', listener)
    knex.on('query-error', listener)
    return () => {
      knex.removeListener('query-response', listener)
      knex.removeListener('query-error', listener)
    }
  }

  return { onQuery, captureQueries, onQuerySettled }
}
