import { sql } from 'kysely'

import { type Db, isInTransaction } from '@/lib/database/kysely'

let savepointCounter = 0

/**
 * Runs `callback` inside a savepoint of the open transaction `trx`. If it
 * throws, the transaction rolls back to the savepoint and the error is
 * rethrown, so the caller can catch it and carry on with the same transaction.
 *
 * PostgreSQL aborts the whole transaction when any statement fails, so catching
 * a failed statement (a unique violation to skip, say) is only safe behind a
 * savepoint; SQLite keeps the transaction usable either way. This is what a
 * nested Knex `trx.transaction(...)` did. `trx` must be the transaction handed
 * to `inTransaction`: on a root instance each statement could run on another
 * pooled connection.
 */
export const inSavepoint = async <T>(
  trx: Db,
  callback: () => Promise<T>
): Promise<T> => {
  if (!isInTransaction(trx)) {
    throw new Error('inSavepoint() needs the transaction from inTransaction()')
  }
  const name = sql.id(`kysely_savepoint_${++savepointCounter}`)
  await sql`savepoint ${name}`.execute(trx)
  try {
    const result = await callback()
    await sql`release savepoint ${name}`.execute(trx)
    return result
  } catch (error) {
    try {
      await sql`rollback to savepoint ${name}`.execute(trx)
      await sql`release savepoint ${name}`.execute(trx)
    } catch {
      // The connection is gone or the transaction is already aborted; the
      // error that got us here is the one worth reporting.
    }
    throw error
  }
}
