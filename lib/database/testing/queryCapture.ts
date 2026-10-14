import type { QueryEvent as ConnectionQueryEvent } from '@/lib/database/connection'

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
export type QueryEvent = ConnectionQueryEvent

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

/**
 * `onQuery` and `captureQueries` over a statement subscription, such as the
 * `onQuery` of the connection `createTestDatabase` opens.
 */
export const createQueryCapture = (
  subscribe: OnQuery
): { onQuery: OnQuery; captureQueries: CaptureQueries } => {
  const captureQueries: CaptureQueries = async (work) => {
    const captured: CapturedQuery[] = []
    const unsubscribe = subscribe(({ sql, bindings }) => {
      captured.push({ sql, bindings })
    })
    try {
      await work()
    } finally {
      unsubscribe()
    }
    return captured
  }
  return { onQuery: subscribe, captureQueries }
}
