import { sql } from 'kysely'
import { randomUUID } from 'node:crypto'

import type {
  ConsumeRateLimitParams,
  DeleteRateLimitsParams,
  RateLimitConsumeResult
} from '@/lib/database/domains/rateLimit/types'
import type { Db } from '@/lib/database/kysely'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// The opportunistic cleanup runs on every Nth consume and deletes at most this
// many expired rows, so a request never pays for an unbounded delete. The batch
// is larger than the interval so a burst of expired rows is cleared faster than
// it accumulates.
const CLEANUP_EVERY = 100
const CLEANUP_BATCH = 500

// Start at a random offset in [0, CLEANUP_EVERY) so a short-lived instance
// (a scale-out replica, a one-off request) still reaches a cleanup instead of
// waiting for its hundredth hit.
let consumesSinceCleanup = Math.floor(Math.random() * CLEANUP_EVERY)

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
//
// `id` is a fresh UUID, not the key: `key` is the conflict target, and on
// PostgreSQL a concurrent first hit that collided on the primary key instead
// would raise 23505 rather than take the `DO UPDATE` path. A UUID also keeps
// the row id inside the `varchar(255)` column whatever the key length.
const consumeStatement = (
  db: Db,
  { key, limit, windowMs, now = Date.now() }: ConsumeRateLimitParams
) => {
  const windowEnd = now + windowMs
  return db
    .insertInto('rateLimit')
    .values({ id: randomUUID(), key, count: 1, lastRequest: windowEnd })
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
  const row = await consumeStatement(db, { ...params, now })

  consumesSinceCleanup += 1
  if (consumesSinceCleanup >= CLEANUP_EVERY) {
    consumesSinceCleanup = 0
    // Best effort: a failed prune must not turn a request away.
    await deleteRateLimits(db, {
      keyPrefix,
      before: now,
      limit: CLEANUP_BATCH
    }).catch((error) => {
      logger.warn(
        { err: toLoggableError(error) },
        'Failed to prune expired rate limit rows'
      )
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
    let query = db.deleteFrom('rateLimit').where('key', 'in', (eb) => {
      let subquery = eb
        .selectFrom('rateLimit')
        .select('key')
        .where('key', 'like', prefix)
      if (before !== undefined) {
        subquery = subquery.where('lastRequest', '<', before)
      }
      return subquery.orderBy('lastRequest').limit(size)
    })
    // Repeat the expiry predicate on the DELETE itself: on PostgreSQL a row
    // renewed between the candidate subquery and the delete would otherwise
    // still be deleted.
    if (before !== undefined) {
      query = query.where('lastRequest', '<', before)
    }
    const result = await query.executeTakeFirst()
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
