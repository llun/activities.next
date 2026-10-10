import type { Knex } from 'knex'
import { AsyncLocalStorage } from 'node:async_hooks'

// Knex and Kysely share one connection pool: the Kysely driver
// (lib/database/kysely/driver.ts) borrows its connections from the Knex
// client. Inside a Knex transaction, `kyselyFor(trx)` borrows the
// transaction's own connection, so ported and unported code can share one
// transaction. What cannot work is the ROOT instance of either library inside
// a transaction the other one opened: it needs a second pooled connection
// (SQLite has exactly one, and PostgreSQL defaults to one in
// lib/config/database.ts, so it deadlocks), and even when the pool has room
// its work runs outside the transaction, so a rollback silently keeps it.
//
// Both directions now throw `MixedDatabaseTransactionError` before touching
// the pool. Each library's open transaction is recorded in an
// AsyncLocalStorage frame for the async context that runs its callback, and
// the other library's root connection acquisition checks for a live frame.
//
// The frame follows async context, so the other library's root instance is
// refused while the transaction is open, whether the work was awaited or not.
// Don't start detached (un-awaited) database work inside a transaction; run it
// after the transaction resolves (a Knex trx can't be used after commit).

export class MixedDatabaseTransactionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MixedDatabaseTransactionError'
  }
}

// One key per database: a Knex transaction's client is a fresh object, but it
// shares the root client's `config`.
export type DatabaseKey = object
export const getDatabaseKey = (client: Knex.Client): DatabaseKey =>
  (client.config as object | undefined) ?? client

type KnexTransactionFrame = {
  key: DatabaseKey
  transaction: Knex.Transaction
}

type KyselyConnectionFrame = {
  key: DatabaseKey
  connection: object
  active: boolean
}

const knexTransactionFrames = new AsyncLocalStorage<
  readonly KnexTransactionFrame[]
>()
const kyselyConnectionFrames = new AsyncLocalStorage<
  readonly KyselyConnectionFrame[]
>()

const hasOpenKnexTransaction = (key: DatabaseKey) =>
  (knexTransactionFrames.getStore() ?? []).some(
    (frame) => frame.key === key && !frame.transaction.isCompleted()
  )

const hasActiveKyselyConnection = (key: DatabaseKey) =>
  (kyselyConnectionFrames.getStore() ?? []).some(
    (frame) => frame.key === key && frame.active
  )

// Called by the root Kysely instance before it borrows a pooled connection.
export const assertRootKyselyMayAcquire = (key: DatabaseKey) => {
  if (hasOpenKnexTransaction(key)) {
    throw new MixedDatabaseTransactionError(
      'The root Kysely instance was used inside an open Knex transaction. ' +
        'It would need a second pooled connection (a deadlock on SQLite) and ' +
        'would run outside the transaction. Use kyselyFor(trx) with the Knex ' +
        'transaction instead.'
    )
  }
  if (hasActiveKyselyConnection(key)) {
    throw new MixedDatabaseTransactionError(
      'The root Kysely instance was used while this async context already ' +
        'holds a Kysely connection (inside db.transaction().execute() or ' +
        'db.connection().execute()). Use the transaction or connection object ' +
        'passed to the callback instead.'
    )
  }
}

// Runs `callback` with `connection` recorded as held by the root Kysely
// instance for this async context. The frame is deactivated (frames are
// immutable, so it cannot be removed) once the callback settles, so work the
// callback started without awaiting is not refused afterwards.
export const runWithKyselyConnection = async <T>(
  key: DatabaseKey,
  connection: object,
  callback: () => Promise<T>
): Promise<T> => {
  const frame: KyselyConnectionFrame = { key, connection, active: true }
  const frames = [...(kyselyConnectionFrames.getStore() ?? []), frame]
  try {
    return await kyselyConnectionFrames.run(frames, callback)
  } finally {
    frame.active = false
  }
}

// True when `connection` is the one the current async context borrowed
// through `runWithKyselyConnection`. A Kysely controlled transaction
// (`db.startTransaction()`) hands its connection out of that context, which
// this detects.
export const isConnectionHeldByCurrentContext = (connection: object) =>
  (kyselyConnectionFrames.getStore() ?? []).some(
    (frame) => frame.connection === connection && frame.active
  )

type GuardedClient = Knex.Client & {
  transaction: (
    container: unknown,
    config: unknown,
    outerTx: unknown
  ) => Knex.Transaction
}

const guardedClients = new WeakSet<Knex.Client>()

// Hooks the root Knex client (once) so that:
// - every Knex transaction callback runs inside a frame naming its database;
// - acquiring a ROOT Knex connection (a root query, or a new transaction)
//   while this async context holds a root Kysely connection throws.
//
// A Knex transaction's queries go through the transaction's own client, whose
// `acquireConnection` just returns the transaction connection, so they never
// reach this hook. The hook has to be in place before the first Knex
// transaction that might contain a Kysely call, which is why getSQLDatabase
// installs it eagerly rather than on first Kysely use.
//
// Known gap: `knex.transaction()` without a callback (the promise and
// `transactionProvider` forms) hands the transaction back to the caller's own
// context, so no frame covers it. The codebase does not use those forms.
export const installKnexKyselyGuard = (knex: Knex) => {
  const client = knex?.client as GuardedClient | undefined
  if (!client || guardedClients.has(client)) return
  guardedClients.add(client)
  const key = getDatabaseKey(client)

  const originalTransaction = client.transaction
  client.transaction = function guardedTransaction(
    this: GuardedClient,
    container: unknown,
    config: unknown,
    outerTx: unknown
  ) {
    if (typeof container !== 'function') {
      return originalTransaction.call(this, container, config, outerTx)
    }
    const wrapped = (transaction: Knex.Transaction) =>
      knexTransactionFrames.run(
        [...(knexTransactionFrames.getStore() ?? []), { key, transaction }],
        () => container(transaction)
      )
    return originalTransaction.call(this, wrapped, config, outerTx)
  }

  const originalAcquireConnection = client.acquireConnection
  client.acquireConnection = function guardedAcquireConnection(
    this: Knex.Client
  ) {
    if (hasActiveKyselyConnection(key)) {
      return Promise.reject(
        new MixedDatabaseTransactionError(
          'A root Knex query was issued inside an open Kysely transaction ' +
            '(or db.connection() callback). It would need a second pooled ' +
            'connection (a deadlock on SQLite) and would run outside the ' +
            'transaction. Port the Knex code it calls, or open the ' +
            'transaction with Knex and use kyselyFor(trx) inside it.'
        )
      )
    }
    return originalAcquireConnection.call(this)
  }
}
