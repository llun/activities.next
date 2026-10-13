import type { AccessMode, IsolationLevel, Kysely, Transaction } from 'kysely'

import type { DB } from '@/lib/database/kysely/db'
import { runInTransactionScope } from '@/lib/database/kysely/guard'

export type { DB } from '@/lib/database/kysely/db'
export { TransactionScopeError } from '@/lib/database/kysely/guard'

/** What a domain query takes: the root instance or an open transaction. */
export type Db = Kysely<DB> | Transaction<DB>

/** Whether `db` already runs inside a transaction. */
export const isInTransaction = (db: Db): boolean => db.isTransaction

/**
 * How a new transaction starts. PostgreSQL honours both
 * (`start transaction isolation level … read only`); SQLite's `begin` takes
 * neither, and its transaction reads one snapshot anyway.
 */
export type TransactionOptions = {
  isolationLevel?: IsolationLevel
  accessMode?: AccessMode
}

/**
 * Runs `callback` in a transaction: `db` itself when it already is one,
 * otherwise a new Kysely transaction, started with `options`. Options cannot
 * change a transaction that is already open, so passing any with a
 * transaction rejects.
 *
 * While the new transaction is open, the root instance of the same database
 * refuses to run anything in this async context (see guard.ts): use the
 * transaction passed to `callback`.
 */
export const inTransaction = <T>(
  db: Db,
  callback: (trx: Db) => Promise<T>,
  { isolationLevel, accessMode }: TransactionOptions = {}
): Promise<T> => {
  if (isInTransaction(db)) {
    if (isolationLevel || accessMode) {
      return Promise.reject(
        new Error(
          'inTransaction cannot set the isolation level or access mode of a ' +
            'transaction that is already open'
        )
      )
    }
    return callback(db)
  }
  // Every instance derived from one root instance (withPlugin, a
  // transaction) shares its adapter, which is what the driver knows too.
  const key = db.getExecutor().adapter
  let builder = db.transaction()
  if (isolationLevel) builder = builder.setIsolationLevel(isolationLevel)
  if (accessMode) builder = builder.setAccessMode(accessMode)
  return builder.execute((trx) =>
    runInTransactionScope(key, () => callback(trx))
  )
}

// `never` arguments accept a query function of any parameter list after `db`:
// none, optional, one params object or several positional arguments.
type Query = (db: Db, ...args: never[]) => Promise<unknown>
type QueryMap = Record<string, Query>

// Keeps the query's own arguments after `db`: none, optional or required.
export type BoundQueries<Q extends QueryMap> = {
  [K in keyof Q]: Q[K] extends (db: Db, ...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<R>
    : never
}

/**
 * Turns a domain's `(db, params) => …` query functions into the facade
 * methods `getSQLDatabase` spreads into `Database`. `getDb` is called on every
 * method call.
 */
export const bindDb = <Q extends QueryMap>(
  getDb: () => Db,
  queries: Q
): BoundQueries<Q> =>
  Object.fromEntries(
    Object.entries(queries).map(([name, query]) => [
      name,
      (...args: never[]) => query(getDb(), ...args)
    ])
  ) as BoundQueries<Q>
