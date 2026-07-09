export const TRENDS_DAYS = 7
export const TRENDS_DEFAULT_LIMIT = 10
export const TRENDS_MAX_LIMIT = 20
// GET /api/v1/trends/statuses has its own, larger window per
// https://docs.joinmastodon.org/methods/trends/#statuses ("Defaults to 20
// statuses. Max 40 statuses."), unlike tags/links (default 10, max 20).
export const TRENDS_STATUSES_DEFAULT_LIMIT = 20
export const TRENDS_STATUSES_MAX_LIMIT = 40

// Garbage or absent input falls back to the default; valid input is clamped
// to the endpoint's Mastodon maximum. Mirrors normalizeSuggestionsLimit.
const normalizeLimit = (
  rawLimit: string | null,
  { fallback, max }: { fallback: number; max: number }
): number => {
  const limit = rawLimit !== null ? Number(rawLimit) : null
  return Number.isSafeInteger(limit) && limit && limit > 0
    ? Math.min(limit, max)
    : fallback
}

export const normalizeTrendsLimit = (rawLimit: string | null): number =>
  normalizeLimit(rawLimit, {
    fallback: TRENDS_DEFAULT_LIMIT,
    max: TRENDS_MAX_LIMIT
  })

export const normalizeTrendsStatusesLimit = (rawLimit: string | null): number =>
  normalizeLimit(rawLimit, {
    fallback: TRENDS_STATUSES_DEFAULT_LIMIT,
    max: TRENDS_STATUSES_MAX_LIMIT
  })

export const normalizeTrendsOffset = (rawOffset: string | null): number => {
  const offset = rawOffset !== null ? Number(rawOffset) : null
  return Number.isSafeInteger(offset) && offset && offset > 0 ? offset : 0
}
