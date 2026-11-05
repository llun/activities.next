import { NextRequest } from 'next/server'

import {
  WindowCounterResult,
  createWindowCounter
} from '@/lib/services/gallery/lookups/rateLimit'
import { getTrustedClientIp } from '@/lib/utils/getTrustedClientIp'

export const REMOTE_FOLLOW_PER_IP_LIMIT = 10
export const REMOTE_FOLLOW_GLOBAL_LIMIT = 60
export const REMOTE_FOLLOW_WINDOW_MS = 60_000
const REMOTE_FOLLOW_MAX_IP_KEYS = 10_000

const perIpCounter = createWindowCounter({
  limit: REMOTE_FOLLOW_PER_IP_LIMIT,
  windowMs: REMOTE_FOLLOW_WINDOW_MS,
  maxKeys: REMOTE_FOLLOW_MAX_IP_KEYS
})

const globalCounter = createWindowCounter({
  limit: REMOTE_FOLLOW_GLOBAL_LIMIT,
  windowMs: REMOTE_FOLLOW_WINDOW_MS,
  maxKeys: 1
})

export const checkRemoteFollowRateLimit = (
  req: NextRequest
): WindowCounterResult => {
  const clientIp = getTrustedClientIp(req)
  if (clientIp) {
    const ipResult = perIpCounter.consume(clientIp)
    if (!ipResult.allowed) return ipResult
  }
  return globalCounter.consume('global')
}

export const resetRemoteFollowRateLimitsForTests = () => {
  perIpCounter.reset()
  globalCounter.reset()
}
