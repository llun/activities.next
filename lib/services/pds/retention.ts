import type { Database } from '@/lib/database/types'

import { deletePdsBlobFilesBestEffort } from './blobStorage'
import { PDS_EVENT_RETENTION_MS } from './constants'

// Kept separate from `events.ts` so CommonJS callers (e.g. `actorDeletion.ts`
// loaded via `scripts/run.cjs` or CJS tests) can import it without pulling in
// ESM-only `@atproto/*` packages.

/**
 * Prunes `pds_events` rows older than the retention window (default 7 days).
 */
export const pruneExpiredPdsEvents = async (
  database: Database,
  {
    now = new Date(),
    retentionMs = PDS_EVENT_RETENTION_MS
  }: { now?: Date | number; retentionMs?: number } = {}
): Promise<number> => {
  const nowMs = now instanceof Date ? now.getTime() : now
  const cutoff = new Date(nowMs - retentionMs)
  return database.deletePdsEventsBefore({ before: cutoff })
}

/**
 * Removes the tombstone rows a deleted hosted account keeps until the event
 * window has passed: `pds_repos` rows with status `deleted` whose `updatedAt`
 * is older than the retention window, along with their remaining events,
 * preferences and any content the delete left behind.
 *
 * The blob files were purged when the account was deleted; deleting the keys
 * again is best effort and never blocks the row removal.
 */
export const pruneDeletedPdsRepos = async (
  database: Database,
  {
    now = new Date(),
    retentionMs = PDS_EVENT_RETENTION_MS
  }: { now?: Date | number; retentionMs?: number } = {}
): Promise<number> => {
  const nowMs = now instanceof Date ? now.getTime() : now
  const cutoff = new Date(nowMs - retentionMs)
  const dids = await database.listDeletedPdsReposBefore({ before: cutoff })
  for (const did of dids) {
    const { blobStorageKeys } = await database.deletePdsRepoData({ did })
    await deletePdsBlobFilesBestEffort(blobStorageKeys, {
      context: { did, reason: 'expired_pds_tombstone' }
    })
  }
  return dids.length
}
