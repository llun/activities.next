export const TRENDS_DAYS = 7
export const TRENDS_DEFAULT_LIMIT = 10
export const TRENDS_MAX_LIMIT = 20

// Garbage or absent input falls back to the default; valid input is clamped
// to the Mastodon maximum of 20. Mirrors normalizeSuggestionsLimit.
export const normalizeTrendsLimit = (rawLimit: string | null): number => {
  const limit = rawLimit !== null ? Number(rawLimit) : null
  return Number.isSafeInteger(limit) && limit && limit > 0
    ? Math.min(limit, TRENDS_MAX_LIMIT)
    : TRENDS_DEFAULT_LIMIT
}

export const normalizeTrendsOffset = (rawOffset: string | null): number => {
  const offset = rawOffset !== null ? Number(rawOffset) : null
  return Number.isSafeInteger(offset) && offset && offset > 0 ? offset : 0
}
