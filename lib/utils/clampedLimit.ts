import { z } from 'zod'

// Treat an absent or blank query value as "not provided" so it resolves to the
// fallback rather than coercing an empty string to `0`.
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

/**
 * Zod schema for a Mastodon-style `limit` query parameter that CLAMPS
 * out-of-range values into `[min, max]` (and falls back to `fallback` for
 * absent or non-numeric input) instead of rejecting them.
 *
 * Mastodon clamps pagination limits rather than returning an error, and so do
 * this app's timeline routes (see `normalizeTimelineLimit`). Validating with a
 * hard `.max()` instead makes the entire `schema.safeParse(query)` fail, so a
 * single out-of-range `limit` 400s/422s the whole request — which breaks real
 * clients that ask for more rows than the cap (e.g. iOS apps sending
 * `limit=100` to `/api/v1/accounts/:id/statuses`, whose cap is 40).
 *
 * Callers must pass `min <= max` and `min <= fallback <= max`.
 *
 * @param max The maximum number of rows the endpoint allows.
 * @param fallback The default used when `limit` is absent or non-numeric.
 * @param min The minimum allowed value (Mastodon clamps up to 1).
 */
export const clampedLimit = (max: number, fallback: number, min = 1) => {
  const clamp = (value: number) =>
    Math.min(Math.max(Math.trunc(value), min), max)
  // Clamp the fallback once so every branch (transform else, catch, default)
  // yields an in-range value even if a caller violates the precondition.
  const safeFallback = clamp(fallback)
  return z
    .preprocess(blankToUndefined, z.coerce.number())
    .transform((value) =>
      Number.isFinite(value) ? clamp(value) : safeFallback
    )
    .catch(safeFallback)
    .default(safeFallback)
}

/**
 * Zod schema for a Mastodon-style `offset` query parameter that CLAMPS into
 * `[0, max]` (falling back to `fallback` for absent or non-numeric input)
 * instead of rejecting out-of-range values, for the same reason as
 * {@link clampedLimit}.
 *
 * Callers must pass `0 <= fallback <= max`.
 *
 * @param max The maximum offset the endpoint allows.
 * @param fallback The default used when `offset` is absent or non-numeric.
 */
export const clampedOffset = (max = Number.MAX_SAFE_INTEGER, fallback = 0) => {
  const clamp = (value: number) => Math.min(Math.max(Math.trunc(value), 0), max)
  const safeFallback = clamp(fallback)
  return z
    .preprocess(blankToUndefined, z.coerce.number())
    .transform((value) =>
      Number.isFinite(value) ? clamp(value) : safeFallback
    )
    .catch(safeFallback)
    .default(safeFallback)
}
