import { sql } from 'kysely'

import type {
  ConsumeRateLimitParams,
  DeleteRateLimitsParams,
  RateLimitConsumeResult
} from '@/lib/database/domains/rateLimit/types'
import type { Db } from '@/lib/database/kysely'
import { logger } from '@/lib/utils/logger'

// The opportunistic cleanup runs on every Nth consume and deletes at most this
// many expired rows, so a request never pays for an unbounded delete.
const CLEANUP_EVERY = 100
const CLEANUP_BATCH = 100

let consumesSinceCleanup = 0

// One atomic statement: insert the first hit, or update the existing row. The
// window is fixed: `lastRequest` holds the window's END (epoch ms), so a row
// whose end has passed starts a new window at `now + windowMs`. `count` stops
// at `limit + 1`, which is enough to tell an allowed hit (count <= limit) from
// a refused one without a second read, and keeps the integer column bounded.
//
// `lastRequest` is the window end rather than the last hit on purpose:
// better-auth prunes rows whose `lastRequest` is older than its longest window
// (300 s), and a future value keeps a live app row (up to a one-hour window)
// out of that prune. Our own cleanup only touches rows under `keyPrefix`.
const consumeStatement = (
  db: Db,
  { key, limit, windowMs, now = Date.now() }: ConsumeRateLimitParams
) => {
  const windowEnd = now + windowMs
  return db
    .insertInto('rateLimit')
    .values({ id: key, key, count: 1, lastRequest: windowEnd })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet((eb) => ({
        count: sql<number>`case
          when ${eb.ref('rateLimit.lastRequest')} <= ${now} then 1
          when ${eb.ref('rateLimit.count')} <= ${limit} then ${eb.ref('rateLimit.count')} + 1
          else ${eb.ref('rateLimit.count')}
        end`,
        lastRequest: sql<number>`case
          when ${eb.ref('rateLimit.lastRequest')} <= ${now} then ${windowEnd}
          else ${eb.ref('rateLimit.lastRequest')}
        end`
      }))
    )
    .returning(['count', 'lastRequest'])
    .executeTakeFirstOrThrow()
}

export const consumeRateLimit = async (
  db: Db,
  params: ConsumeRateLimitParams
): Promise<RateLimitConsumeResult> => {
  const { keyPrefix, limit, now = Date.now() } = params
  const row = await consumeStatement(db, params)

  consumesSinceCleanup += 1
  if (consumesSinceCleanup >= CLEANUP_EVERY) {
    consumesSinceCleanup = 0
    // Best effort: a failed prune must not turn a request away.
    await deleteRateLimits(db, {
      keyPrefix,
      before: now,
      limit: CLEANUP_BATCH
    }).catch((error) => {
      logger.warn({ error }, 'Failed to prune expired rate limit rows')
    })
  }

  const allowed = row.count <= limit
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((row.lastRequest - now) / 1000))
  }
}

export const deleteRateLimits = async (
  db: Db,
  { keyPrefix, before, limit }: DeleteRateLimitsParams
): Promise<number> => {
  const prefix = `${keyPrefix}%`

  if (limit !== undefined) {
    const size = Math.max(0, Math.floor(limit))
    if (size === 0) return 0
    const result = await db
      .deleteFrom('rateLimit')
      .where('key', 'in', (eb) => {
        let subquery = eb
          .selectFrom('rateLimit')
          .select('key')
          .where('key', 'like', prefix)
        if (before !== undefined) {
          subquery = subquery.where('lastRequest', '<', before)
        }
        return subquery.orderBy('lastRequest').limit(size)
      })
      .executeTakeFirst()
    return Number(result.numDeletedRows)
  }

  let query = db.deleteFrom('rateLimit').where('key', 'like', prefix)
  if (before !== undefined) {
    query = query.where('lastRequest', '<', before)
  }
  const result = await query.executeTakeFirst()
  return Number(result.numDeletedRows)
}

export const rateLimitQueries = { consumeRateLimit, deleteRateLimits }
