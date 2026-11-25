import type { Database } from '@/lib/database/types'
import {
  type StoredBlueskyMoveOutSession,
  deleteStoredBlueskySession,
  readStoredBlueskySession,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'

import { PdsMoveOutNotFoundError } from './errors'
import { withPdsRepoLock } from './lock'

// The move's stored session and the lock that serializes every read-modify-
// write of it (token refresh, progress patches, deletes). A refresh that
// finishes after a cancel must not resurrect the row, so all of them take the
// same per-DID lock and re-read the row inside it.

export const REMOTE_JSON_TIMEOUT_MS = 30_000
export const REMOTE_UPLOAD_TIMEOUT_MS = 60_000
export const DEFAULT_BLOB_BATCH_LIMIT = 20
export const MAX_BLOB_BATCH_LIMIT = 100

// Comfortably above one refresh request, so a refresh never outlives its lock.
export const MOVE_REFRESH_LOCK_MS = 2 * REMOTE_JSON_TIMEOUT_MS

// Covers a whole blob batch: the missing-blobs list plus one upload per entry.
export const MOVE_LOCK_MS =
  REMOTE_JSON_TIMEOUT_MS +
  MAX_BLOB_BATCH_LIMIT * REMOTE_UPLOAD_TIMEOUT_MS +
  30_000

const moveRefreshLock = <T>(
  database: Database,
  did: string,
  fn: () => Promise<T>
): Promise<T> =>
  withPdsRepoLock(database, `move-refresh:${did}`, fn, {
    ttlMs: MOVE_REFRESH_LOCK_MS,
    waitMs: MOVE_REFRESH_LOCK_MS
  })

export const readMoveOutSession = async (
  database: Database,
  did: string
): Promise<StoredBlueskyMoveOutSession | null> => {
  const stored = await readStoredBlueskySession(database, did)
  return stored?.type === 'move-out' ? stored : null
}

/**
 * Patches the move's non-token fields (`importedRev`, `switchedAt`) under the
 * move-refresh lock, re-reading the row first. Tokens are written only by
 * `refreshMoveOutTokens`, so a patch can never overwrite fresher ones.
 */
export const updateMoveOutSession = async (
  database: Database,
  did: string,
  patch: { importedRev?: string | null; switchedAt?: number }
): Promise<StoredBlueskyMoveOutSession> =>
  moveRefreshLock(database, did, async () => {
    const current = await readMoveOutSession(database, did)
    if (!current) throw new PdsMoveOutNotFoundError()
    const next: StoredBlueskyMoveOutSession = {
      ...current,
      ...(patch.importedRev !== undefined
        ? { importedRev: patch.importedRev }
        : {}),
      ...(patch.switchedAt !== undefined
        ? { switchedAt: patch.switchedAt }
        : {}),
      type: 'move-out'
    }
    await writeStoredBlueskySession(database, did, next)
    return next
  })

/**
 * Deletes the stored move under the move-refresh lock, re-reading the row
 * first, so a refresh already in flight cannot write it back afterwards.
 */
export const deleteMoveOutSession = async (
  database: Database,
  did: string
): Promise<void> =>
  moveRefreshLock(database, did, async () => {
    const current = await readMoveOutSession(database, did)
    if (!current) return
    await deleteStoredBlueskySession(database, did, 'move-out')
  })
