import type { Database } from '@/lib/database/types'
import {
  type StoredBlueskyMoveOutSession,
  deleteStoredBlueskySession,
  readStoredBlueskySession,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'
import { logger } from '@/lib/utils/logger'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { PdsMoveOutNotFoundError } from './errors'
import { withPdsRepoLock } from './lock'

// The move's stored session and the lock that serializes every read-modify-
// write of it (token refresh, progress patches, deletes). A refresh that
// finishes after a cancel must not resurrect the row, so all of them take the
// same per-DID lock and re-read the row inside it.

export const REMOTE_JSON_TIMEOUT_MS = 30_000
export const REMOTE_UPLOAD_TIMEOUT_MS = 60_000
// Small batches keep each request (and the lock it holds) short; a page's
// cursor always advances, so a blob that fails is passed over, not retried.
export const DEFAULT_BLOB_BATCH_LIMIT = 5
export const MAX_BLOB_BATCH_LIMIT = 5

// safeRemoteFetch applies the connect and read timeouts separately, so one
// request can take up to twice its `timeoutInMilliseconds`.
export const REMOTE_JSON_WORST_MS = 2 * REMOTE_JSON_TIMEOUT_MS
export const REMOTE_UPLOAD_WORST_MS = 2 * REMOTE_UPLOAD_TIMEOUT_MS

// Covers one refresh request, with slack for the re-read and write around it.
export const MOVE_REFRESH_LOCK_MS = REMOTE_JSON_WORST_MS + 15_000

// Covers the longest move step: a blob batch (the list, a refresh, one upload
// per entry at the largest batch, and the request re-sent after a refresh).
export const MOVE_LOCK_MS =
  2 * REMOTE_JSON_WORST_MS +
  (MAX_BLOB_BATCH_LIMIT + 1) * REMOTE_UPLOAD_WORST_MS +
  30_000

// How long a move or delete lock waits for its holder before giving up.
export const MOVE_LOCK_WAIT_MS = 30_000

const moveRefreshLock = <T>(
  database: Database,
  did: string,
  fn: () => Promise<T>
): Promise<T> =>
  withPdsRepoLock(database, `move-refresh:${did}`, fn, {
    ttlMs: MOVE_REFRESH_LOCK_MS,
    waitMs: MOVE_LOCK_WAIT_MS
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
 * Returns the row it deleted, which is the one whose tokens the caller must
 * revoke: a refresh may have rotated them since the caller read the move.
 */
export const deleteMoveOutSession = async (
  database: Database,
  did: string
): Promise<StoredBlueskyMoveOutSession | null> =>
  moveRefreshLock(database, did, async () => {
    const current = await readMoveOutSession(database, did)
    if (!current) return null
    await deleteStoredBlueskySession(database, did, 'move-out')
    return current
  })

/**
 * Best effort: the move is done either way, so a failure only leaves the
 * destination session alive until it expires. Callers pass the row they
 * deleted, not an in-memory copy a refresh may have replaced.
 */
export const revokeMoveOutTokens = async (
  session: StoredBlueskyMoveOutSession | null
): Promise<void> => {
  if (!session) return
  try {
    const response = await safeRemoteFetch({
      url: new URL('/xrpc/com.atproto.server.deleteSession', session.pdsUrl)
        .href,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.refreshJwt}`
      },
      maxRedirects: 0,
      allowCrossHostRedirects: false,
      timeoutInMilliseconds: REMOTE_JSON_TIMEOUT_MS
    })
    if (response.statusCode < 200 || response.statusCode >= 300) {
      logger.warn({
        message: 'Destination server refused to revoke the move session',
        pdsUrl: session.pdsUrl,
        statusCode: response.statusCode
      })
    }
  } catch (error) {
    logger.warn({
      message: 'Could not revoke the move session on the destination server',
      pdsUrl: session.pdsUrl,
      err: toLoggableError(error)
    })
  }
}
