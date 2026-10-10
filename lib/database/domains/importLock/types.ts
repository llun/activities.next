// Parameter and result types of the import lock domain (fitness import
// locks). Moved out of lib/database/sql/importLock.ts.

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
