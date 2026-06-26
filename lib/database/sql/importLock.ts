import { Knex } from 'knex'
import crypto from 'node:crypto'

const IMPORT_LOCKS_TABLE = 'fitness_import_locks'

export interface AcquireImportLockParams {
  lockKey: string
  ttlMs: number
  // Injectable clock so tests can exercise expiry deterministically.
  now?: number
}

export interface ReleaseImportLockParams {
  lockKey: string
  token: string
}

export interface ImportLockDatabase {
  /**
   * Tries to claim the lock identified by `lockKey`. Returns a `{ token }` when
   * acquired, or `null` when a live (non-expired) lock is already held. A lock
   * whose `expiresAt` has passed is treated as abandoned (its holder crashed)
   * and is stolen. The returned `token` must be passed back to
   * `releaseImportLock` so only the current holder can release it.
   */
  acquireImportLock(
    params: AcquireImportLockParams
  ): Promise<{ token: string } | null>
  releaseImportLock(params: ReleaseImportLockParams): Promise<boolean>
}

export const ImportLockSQLDatabaseMixin = (
  database: Knex
): ImportLockDatabase => ({
  async acquireImportLock({ lockKey, ttlMs, now = Date.now() }) {
    const token = crypto.randomUUID()
    const expiresAt = now + Math.max(0, ttlMs)

    // Drop an expired lock first so a crashed holder can never block forever.
    await database(IMPORT_LOCKS_TABLE)
      .where('lockKey', lockKey)
      .where('expiresAt', '<=', now)
      .del()

    // Claim the key. If a live lock still holds it, the insert is ignored.
    // `onConflict().ignore()` is supported across SQLite, PostgreSQL and MySQL.
    await database(IMPORT_LOCKS_TABLE)
      .insert({ lockKey, token, expiresAt })
      .onConflict('lockKey')
      .ignore()

    // We hold the lock only if the persisted token is the one we just wrote.
    const row = await database(IMPORT_LOCKS_TABLE)
      .where('lockKey', lockKey)
      .first()
    return row && row.token === token ? { token } : null
  },

  async releaseImportLock({ lockKey, token }) {
    const removed = await database(IMPORT_LOCKS_TABLE)
      .where('lockKey', lockKey)
      .where('token', token)
      .del()
    return removed > 0
  }
})
