import { z } from 'zod'

/**
 * A text query value as a client sends it, minus the one byte a database
 * cannot take.
 *
 * PostgreSQL rejects a NUL byte in a bound text parameter (22021 "invalid byte
 * sequence for encoding UTF8: 0x00"), so a value carrying one would turn the
 * lookup into a 500 there while SQLite matched nothing. A stored value cannot
 * hold one, so it is malformed and the route answers 400. Only NUL is refused,
 * not a shape: other control characters are valid text, and an unknown value
 * is not rejected, it keeps the route's ordinary answer.
 */
export const NulFreeString = z
  .string()
  .refine((value) => !value.includes('\u0000'), 'Must not contain a NUL byte')

/** An `activity_type` filter as a client sends it. */
export const ActivityTypeParam = NulFreeString

/**
 * The route heatmap's `activity_type`: trimmed, with a missing or blank value
 * meaning all activities.
 */
export const TrimmedOptionalActivityTypeParam = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  ActivityTypeParam.optional()
)
