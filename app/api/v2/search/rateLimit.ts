import {
  WindowCounterResult,
  createWindowCounter
} from '@/lib/services/gallery/lookups/rateLimit'

export const SEARCH_RESOLVE_LIMIT = 30
export const SEARCH_RESOLVE_WINDOW_MS = 60_000
const SEARCH_RESOLVE_MAX_KEYS = 10_000

const resolveCounter = createWindowCounter({
  limit: SEARCH_RESOLVE_LIMIT,
  windowMs: SEARCH_RESOLVE_WINDOW_MS,
  maxKeys: SEARCH_RESOLVE_MAX_KEYS
})

export const checkSearchResolveRateLimit = (
  actorId: string
): WindowCounterResult => resolveCounter.consume(actorId)

export const resetSearchResolveRateLimitForTests = () => {
  resolveCounter.reset()
}
