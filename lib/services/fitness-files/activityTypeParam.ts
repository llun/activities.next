import { z } from 'zod'

/**
 * An `activity_type` filter as a client sends it.
 *
 * PostgreSQL rejects a NUL byte in a bound text parameter (22021 "invalid byte
 * sequence for encoding UTF8: 0x00"), so a type carrying one would turn the
 * read into a 500 there while SQLite matched nothing. A stored type cannot
 * hold one, so it is a malformed value and the route answers 400. Only NUL is
 * refused: other control characters are valid text a stored type may hold.
 */
export const ActivityTypeParam = z
  .string()
  .refine((value) => !value.includes('\u0000'), 'Must not contain a NUL byte')

/**
 * The route heatmap's `activity_type`: trimmed, with a missing or blank value
 * meaning all activities.
 */
export const TrimmedOptionalActivityTypeParam = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  ActivityTypeParam.optional()
)
