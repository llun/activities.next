import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

import {
  APP_RATE_LIMIT_KEY_PREFIX,
  type RateLimitConsumeResult
} from '@/lib/database/domains/rateLimit/types'
import type { Database } from '@/lib/database/types'
import { getTrustedClientRateLimitKey } from '@/lib/utils/getTrustedClientIp'
import { logger } from '@/lib/utils/logger'

import { PdsHostedRateLimitedError } from './errors'

export const PDS_SYNC_RATE_LIMIT = 60
export const PDS_SYNC_BLOB_RATE_LIMIT = 120
export const PDS_REPO_READ_RATE_LIMIT = 120
// The shared fallback is a circuit breaker, not a per-client limit: anyone can
// fill it, so it is set high enough that ordinary relay and AppView traffic
// never meets it. Per-client limits need trusted proxy IP headers.
export const PDS_SYNC_ANONYMOUS_RATE_LIMIT = 3_000
export const PDS_SYNC_BLOB_ANONYMOUS_RATE_LIMIT = 6_000
export const PDS_REPO_READ_ANONYMOUS_RATE_LIMIT = 6_000
export const PDS_SYNC_RATE_LIMIT_WINDOW_MS = 60_000

export type PdsRateLimitBucket = 'sync' | 'blob' | 'repo'

const RATE_LIMIT_BY_BUCKET: Record<PdsRateLimitBucket, number> = {
  sync: PDS_SYNC_RATE_LIMIT,
  blob: PDS_SYNC_BLOB_RATE_LIMIT,
  repo: PDS_REPO_READ_RATE_LIMIT
}

const ANONYMOUS_RATE_LIMIT_BY_BUCKET: Record<PdsRateLimitBucket, number> = {
  sync: PDS_SYNC_ANONYMOUS_RATE_LIMIT,
  blob: PDS_SYNC_BLOB_ANONYMOUS_RATE_LIMIT,
  repo: PDS_REPO_READ_ANONYMOUS_RATE_LIMIT
}

let warnedNoClientKey = false

const digestClientKey = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

/**
 * Database-backed rate limit for PDS `com.atproto.sync.*`,
 * `com.atproto.sync.getBlob`, and `com.atproto.repo.*` read endpoints.
 *
 * Keyed per client on `getTrustedClientRateLimitKey` (requires
 * `ACTIVITIES_TRUST_PROXY_IP_HEADERS=true` — operators should also pin
 * `ACTIVITIES_TRUST_PROXY_IP_HEADER` to their proxy's header so spoofable
 * headers are never trusted). When no trusted client key is available, falls
 * back to a coarse shared bucket per endpoint group (`pds:<bucket>:anonymous`)
 * with a higher limit instead of skipping rate limiting altogether.
 */
export const checkPdsSyncRateLimit = async (
  database: Database,
  req: NextRequest | Request,
  bucket: PdsRateLimitBucket
): Promise<RateLimitConsumeResult> => {
  const clientKey = getTrustedClientRateLimitKey(req)
  if (!clientKey && !warnedNoClientKey) {
    warnedNoClientKey = true
    logger.warn({
      message:
        'Bluesky PDS reads have no trusted client IP, so only a shared circuit breaker limits them; set ACTIVITIES_TRUST_PROXY_IP_HEADERS and ACTIVITIES_TRUST_PROXY_IP_HEADER'
    })
  }
  const limit = clientKey
    ? RATE_LIMIT_BY_BUCKET[bucket]
    : ANONYMOUS_RATE_LIMIT_BY_BUCKET[bucket]
  const key = clientKey
    ? `${APP_RATE_LIMIT_KEY_PREFIX}pds-${bucket}:${digestClientKey(clientKey)}`
    : `${APP_RATE_LIMIT_KEY_PREFIX}pds:${bucket}:anonymous`

  return database.consumeRateLimit({
    key,
    keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
    limit,
    windowMs: PDS_SYNC_RATE_LIMIT_WINDOW_MS
  })
}

const DAY_MS = 24 * 60 * 60 * 1000

// Each one submits a PLC operation for the actor's DID, so the directory sees
// every one of them: a day's budget per actor.
export const HOSTED_BLUESKY_RATE_LIMITS = {
  create: 3,
  handle: 10,
  recovery: 10,
  move: 3
} as const

export type HostedBlueskyRateLimitAction =
  keyof typeof HOSTED_BLUESKY_RATE_LIMITS

/**
 * Consumes one hosted-account action for the actor and throws
 * `PdsHostedRateLimitedError` once the day's budget is spent. Call it only
 * after validation, right before the PLC operation it counts.
 */
export const consumeHostedBlueskyRateLimit = async (
  database: Database,
  actorId: string,
  action: HostedBlueskyRateLimitAction
): Promise<void> => {
  const result = await database.consumeRateLimit({
    key: `${APP_RATE_LIMIT_KEY_PREFIX}pds-hosted-${action}:${digestClientKey(actorId)}`,
    keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
    limit: HOSTED_BLUESKY_RATE_LIMITS[action],
    windowMs: DAY_MS
  })
  if (!result.allowed) throw new PdsHostedRateLimitedError()
}
