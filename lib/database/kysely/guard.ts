import { AsyncLocalStorage } from 'node:async_hooks'

// A query on the ROOT Kysely instance while the same async context has a
// transaction open on that database cannot do what the caller meant. The root
// instance needs a connection of its own: on SQLite there is only one, and the
// open transaction holds it, so the query would wait forever; on PostgreSQL it
// gets another pooled connection, so its work runs outside the transaction and
// a rollback silently keeps it (and with the pool at its maximum it waits on
// itself too). This is also what keeps hydration (which reads on the root
// instance) out of transactions, as docs/maintenance.md requires.
//
// `inTransaction` (lib/database/kysely/index.ts) records the transaction in an
// AsyncLocalStorage frame for the async context that runs its callback, keyed
// by the database. The connection's driver (lib/database/connection.ts) calls
// `assertOutsideTransactionScope` before it hands out a connection, so the
// root instance fails at once instead of hanging. Statements on the
// transaction itself never ask the driver for a connection (Kysely gives them
// the transaction's own), so they pass.
//
// The frame follows async context, so work started without `await` inside the
// callback is refused too while the transaction is open. Don't start detached
// database work inside a transaction; run it after the transaction resolves.
//
// Only `inTransaction` records a frame. A transaction opened with
// `db.transaction()`, `db.startTransaction()` or `db.connection()` directly
// would not be guarded, which is why transactionCallSites.test.ts allows those
// calls only under lib/database/kysely/.

export class TransactionScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransactionScopeError'
  }
}

/** Identifies one database: the dialect adapter of its root Kysely instance. */
export type DatabaseKey = object

type TransactionFrame = { key: DatabaseKey; active: boolean }

const transactionFrames = new AsyncLocalStorage<readonly TransactionFrame[]>()

/**
 * Runs `callback` with a transaction on `key` recorded as open for this async
 * context. The frame is deactivated once the callback settles (frames are
 * immutable, so it cannot be removed), so work the callback started without
 * awaiting is not refused after the transaction has ended.
 */
export const runInTransactionScope = async <T>(
  key: DatabaseKey,
  callback: () => Promise<T>
): Promise<T> => {
  const frame: TransactionFrame = { key, active: true }
  const frames = [...(transactionFrames.getStore() ?? []), frame]
  try {
    return await transactionFrames.run(frames, callback)
  } finally {
    frame.active = false
  }
}

/** Throws when this async context has a transaction open on `key`. */
export const assertOutsideTransactionScope = (key: DatabaseKey) => {
  const frames = transactionFrames.getStore()
  if (!frames?.some((frame) => frame.key === key && frame.active)) return
  throw new TransactionScopeError(
    'The root Kysely instance was used while this async context has a ' +
      'transaction open on the same database (inside inTransaction()). It ' +
      'would need a second connection (a deadlock on SQLite) and would run ' +
      'outside the transaction. Use the transaction passed to the callback ' +
      'instead.'
  )
}
