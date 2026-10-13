import type { Kysely, Transaction } from 'kysely'

import type { DB } from '@/lib/database/kysely/db'

export type HeldTransaction = {
  /** The open transaction; every statement on it runs inside it. */
  trx: Transaction<DB>
  /** Commits the transaction and resolves once it has. */
  commit: () => Promise<void>
  /** Rolls the transaction back and resolves once it has. */
  rollback: () => Promise<void>
}

class HeldTransactionRollback extends Error {
  constructor() {
    super('held transaction rolled back')
  }
}

/**
 * Opens a transaction on `db` and keeps it open, for a race test that has to
 * run other work while a transaction holds a row lock or an uncommitted write.
 * `db.transaction().execute(callback)` ends the transaction when the callback
 * returns, so the callback here waits until `commit()` or `rollback()`.
 *
 * Meant for PostgreSQL race tests: SQLite's one connection belongs to the
 * transaction until it ends, so any other query waits for it there. Use `trx`
 * from the test's own async context; the root Kysely instance is refused only
 * inside the callback of its own transaction, and the work started here is
 * outside that callback. Always end it, in a `finally` or `catch`, or the
 * connection stays taken.
 */
export const holdTransaction = async (
  db: Kysely<DB>
): Promise<HeldTransaction> => {
  let end!: (error?: Error) => void
  const ended = new Promise<void>((resolve, reject) => {
    end = (error) => (error ? reject(error) : resolve())
  })
  let opened!: (trx: Transaction<DB>) => void
  const open = new Promise<Transaction<DB>>((resolve) => {
    opened = resolve
  })

  const finished = db.transaction().execute(async (trx) => {
    opened(trx)
    await ended
  })
  // A transaction that cannot begin rejects before it opens.
  const trx = await Promise.race([
    open,
    finished.then(() => {
      throw new Error('the transaction ended before it was opened')
    })
  ])

  return {
    trx,
    commit: async () => {
      end()
      await finished
    },
    rollback: async () => {
      end(new HeldTransactionRollback())
      await finished.catch((error: unknown) => {
        if (!(error instanceof HeldTransactionRollback)) throw error
      })
    }
  }
}
