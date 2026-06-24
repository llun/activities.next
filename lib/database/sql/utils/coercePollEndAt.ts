import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'

/**
 * Coerce a stored poll `endAt` value into a finite millisecond timestamp.
 *
 * `createPoll` always persists a numeric `endAt`, so this only matters for
 * legacy/corrupt rows that predate that guarantee. `StatusPoll.endAt` is a
 * required `number`, so a missing value or an unparseable string (which would
 * otherwise survive a bare `?? Date.now()` and fail `StatusPoll.parse`) is
 * coerced to "now". Numbers, ISO date strings, and SQLite UTC timestamp strings
 * are all normalised through `getCompatibleTime`.
 */
export const coercePollEndAt = (endAt: unknown): number => {
  if (endAt === null || endAt === undefined) return Date.now()
  if (
    typeof endAt !== 'number' &&
    typeof endAt !== 'string' &&
    !(endAt instanceof Date)
  ) {
    return Date.now()
  }
  const coerced = getCompatibleTime(endAt)
  return Number.isFinite(coerced) ? coerced : Date.now()
}
