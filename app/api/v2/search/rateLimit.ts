import { NextRequest } from 'next/server'

import {
  WindowCounterResult,
  createWindowCounter
} from '@/lib/services/gallery/lookups/rateLimit'
import { Actor } from '@/lib/types/domain/actor'
import { getTrustedClientIp } from '@/lib/utils/getTrustedClientIp'

export const SEARCH_RESOLVE_LIMIT = 30
export const SEARCH_RESOLVE_WINDOW_MS = 60_000
const SEARCH_RESOLVE_MAX_KEYS = 10_000

const resolveCounter = createWindowCounter({
  limit: SEARCH_RESOLVE_LIMIT,
  windowMs: SEARCH_RESOLVE_WINDOW_MS,
  maxKeys: SEARCH_RESOLVE_MAX_KEYS
})

export const checkSearchResolveRateLimit = (
  req: NextRequest,
  currentActor?: Actor | null
): WindowCounterResult => {
  if (currentActor) {
    return resolveCounter.consume(`actor:${currentActor.id}`)
  }
  const clientIp = getTrustedClientIp(req)
  if (clientIp) {
    return resolveCounter.consume(`ip:${clientIp}`)
  }
  return { allowed: true }
}

export const resetSearchResolveRateLimitForTests = () => {
  resolveCounter.reset()
}
