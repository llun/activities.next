// Pure, with no server-only imports: the owner details (server) and the media
// details dialog (client) decide "stale" by the same rule.

/**
 * How long a subject or place lookup may stay `pending` before the owner is
 * offered a Retry: a job lost to a queue outage, or one the queue dropped,
 * would otherwise leave "Checking IUCN status…" (or "Looking up the place
 * name…") up for good.
 */
export const STALE_SUBJECT_LOOKUP_MS = 2 * 60 * 1000
export const STALE_PLACE_LOOKUP_MS = 2 * 60 * 1000

/**
 * Whether a lookup has been `pending` for at least `staleMs` since it was
 * marked (`lookupAt`, epoch milliseconds). No time at all counts as stale.
 */
export const isStalePending = (
  status: string | null,
  lookupAt: number | null,
  now: number,
  staleMs: number
) => status === 'pending' && (lookupAt === null || now - lookupAt >= staleMs)
