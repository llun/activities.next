import type { Database } from '@/lib/database/types'

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
