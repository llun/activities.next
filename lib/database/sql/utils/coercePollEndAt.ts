import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'

/**
 * Coerce a stored poll `endAt` value into a finite millisecond timestamp.
 *
 * `createPoll` always persists a numeric `endAt`, so this only matters for
 * legacy/corrupt rows that predate that guarantee. `StatusPoll.endAt` is a
 * required `number`, so a missing value or an unparseable string (which would
 * otherwise survive a bare `?? Date.now()` and fail `StatusPoll.parse`) is
 * coerced to the `fallback`. Numbers, ISO date strings, and SQLite UTC
 * timestamp strings are all normalised through `getCompatibleTime`.
 *
 * `fallback` defaults to `Date.now()`, but the database hydration path passes a
 * stable value (the status creation time) so a corrupt row resolves to the same
 * `endAt` on every read — `Date.now()` would shift forward each read and risk
 * SSR/client hydration mismatches and test instability.
 */
export const coercePollEndAt = (
  endAt: unknown,
  fallback: number = Date.now()
): number => {
  if (endAt === null || endAt === undefined) return fallback
  if (
    typeof endAt !== 'number' &&
    typeof endAt !== 'string' &&
    !(endAt instanceof Date)
  ) {
    return fallback
  }
  const coerced = getCompatibleTime(endAt)
  return Number.isFinite(coerced) ? coerced : fallback
}
