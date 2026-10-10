import type { Knex } from 'knex'
import { DefaultQueryExecutor, Kysely, type Transaction } from 'kysely'

import type { DB } from '@/lib/database/kysely/db'
import {
  KnexConnectionProvider,
  KnexPoolDriver,
  createKnexDialect
} from '@/lib/database/kysely/driver'
import { installKnexKyselyGuard } from '@/lib/database/kysely/guard'

export type { DB } from '@/lib/database/kysely/db'
export {
  MixedDatabaseTransactionError,
  installKnexKyselyGuard
} from '@/lib/database/kysely/guard'

/** What a domain query takes: the root instance or an open transaction. */
export type Db = Kysely<DB> | Transaction<DB>

const instances = new WeakMap<Knex, Kysely<DB>>()
// Adapters of the instances bound to a Knex transaction. Instances derived
// with withPlugin()/withSchema() share the executor's adapter, so this
// recognises them where object identity would not.
const transactionBoundAdapters = new WeakSet<object>()

/**
 * The Kysely instance for a Knex instance or an open Knex transaction.
 *
 * - For the root Knex instance it borrows connections from Knex's pool, so
 *   the two libraries share one pool (and SQLite's single connection).
 * - For a Knex transaction (`kyselyFor(trx)`) every statement runs on the
 *   transaction's own connection, so it commits or rolls back with the Knex
 *   transaction. Calling `.transaction()` on it throws: it is already in one.
 *
 * Instances are created on first use and cached per Knex instance and per
 * transaction object. Call it lazily (inside each query, not when a facade is
 * built): some tests build the database layer around a mocked Knex that has
 * no `client`.
 *
 * `destroy()` on the result is a no-op; Knex owns the pool and closes it in
 * `database.destroy()`.
 */
export const kyselyFor = (knexOrTrx: Knex | Knex.Transaction): Kysely<DB> => {
  const cached = instances.get(knexOrTrx)
  if (cached) return cached

  if (!knexOrTrx?.client) {
    throw new Error('kyselyFor() needs a Knex instance with a client')
  }

  // The guard hooks the ROOT client; a transaction's client is a throwaway
  // object whose connection is already taken.
  if (!(knexOrTrx as { isTransaction?: boolean }).isTransaction) {
    installKnexKyselyGuard(knexOrTrx)
  }
  const dialect = createKnexDialect(knexOrTrx)
  const driver = dialect.createDriver() as KnexPoolDriver
  const adapter = dialect.createAdapter()
  const executor = new DefaultQueryExecutor(
    dialect.createQueryCompiler(),
    adapter,
    new KnexConnectionProvider(driver, knexOrTrx.client)
  )
  const db = new Kysely<DB>({ config: { dialect }, dialect, driver, executor })
  instances.set(knexOrTrx, db)
  if (driver.isTransactionBound) transactionBoundAdapters.add(adapter)
  return db
}

/**
 * Whether `db` already runs inside a transaction: a Kysely transaction, or
 * `kyselyFor(trx)` inside a Knex transaction.
 */
export const isInTransaction = (db: Db): boolean =>
  db.isTransaction || transactionBoundAdapters.has(db.getExecutor().adapter)

/**
 * Runs `callback` in a transaction: `db` itself when it already is one,
 * otherwise a new Kysely transaction.
 */
export const inTransaction = <T>(
  db: Db,
  callback: (trx: Db) => Promise<T>
): Promise<T> => {
  if (isInTransaction(db)) return callback(db)
  return db.transaction().execute(callback)
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
 * method call, so the Kysely instance is only created on first use.
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
