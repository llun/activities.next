// Rewrites notification ids that are not time-ordered (UUIDv4, from before
// createNotification minted UUIDv7s) into UUIDv7s minted from each row's
// createdAt, and repoints the `notifications` read marker at the new id.
//
// Plain ESM JavaScript on purpose: it is shared by the knex migration
// migrations/20261009163215_time_ordered_notification_ids.js — which the knex
// CLI runs as-is, with no TypeScript and no `@/` aliases — and by
// scripts/maintenance/rewriteNotificationIds.ts, the post-rollout pass. It
// imports nothing but `uuid` and logs only through the callback it is given.
import { v7 } from 'uuid'

export const NOTIFICATION_ID_BATCH_SIZE = 500

// Rows folded into one bulk UPDATE. Each row contributes three bind parameters
// (the CASE match, the CASE value and the id in the IN list), so 200 rows is
// 600 parameters — under the 999-parameter floor of the most conservatively
// built SQLite, and nowhere near PostgreSQL's 65535.
const UPDATE_CHUNK_SIZE = 200

// Same strict shape as isPublicId() in lib/utils/publicId.ts: version nibble 7
// and RFC 4122 variant [89ab].
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export const isTimeOrderedNotificationId = (id) =>
  typeof id === 'string' && UUID_V7_PATTERN.test(id)

const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

// SQLite hands back `createdAt` as a naive UTC string ('2024-03-04 05:06:07')
// for rows written by the CURRENT_TIMESTAMP default, which `new Date` would read
// as LOCAL time; PostgreSQL hands back a Date. Mirrors toDate() in
// migrations/20260808000000_add_public_ids.js.
/**
 * @param {unknown} value
 * @returns {Date}
 */
const toDate = (value) => {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed
    return new Date(normalized)
  }
  return new Date(/** @type {number} */ (value))
}

// Mirrors generatePublicId(createdAt) in lib/utils/publicId.ts, which is what
// createNotification uses, so a rewritten row is indistinguishable from a new
// one.
/**
 * @param {unknown} createdAt
 * @returns {string}
 */
export const mintNotificationId = (createdAt) => {
  const time = toDate(createdAt).getTime()
  const msecs = Number.isFinite(time) && time >= 0 ? Math.floor(time) : 0
  return v7({ msecs })
}

/**
 * @param {import('knex').Knex} knex
 * @param {string} column
 * @param {{ from: string, to: string }[]} chunk
 */
const caseExpression = (knex, column, chunk) =>
  knex.raw(
    `case ?? ${chunk.map(() => 'when ? then ?').join(' ')} else ?? end`,
    [column, ...chunk.flatMap(({ from, to }) => [from, to]), column]
  )

// One chunk is rewritten in its own short transaction so the notification ids
// and the marker that points at them move together. Were the two UPDATEs to
// commit separately, an interruption between them would leave the marker on an
// old id that a resumed run can never repoint: the row it named is already v7
// and is skipped. Chunks are awaited one at a time, so a run holds exactly ONE
// pooled connection and leaves the rest of the pool to the app serving traffic
// alongside it (see bulkUpdatePublicIds() in
// migrations/20260808000000_add_public_ids.js for the pool exhaustion this
// avoids).
/**
 * @param {import('knex').Knex} knex
 * @param {{ from: string, to: string }[]} chunk
 * @returns {Promise<{ rewritten: number, markers: number }>}
 */
const rewriteChunk = (knex, chunk) =>
  knex.transaction(async (trx) => {
    const oldIds = chunk.map(({ from }) => from)

    // A v4 id and a v7 id differ in the version nibble, so a minted id can
    // never collide with a row that is still waiting to be rewritten; the
    // primary key stays unique throughout.
    const rewritten = await trx('notifications')
      .whereIn('id', oldIds)
      .update({ id: caseExpression(trx, 'id', chunk) })

    const markers = await trx('markers')
      .where('timeline', 'notifications')
      .whereIn('lastReadId', oldIds)
      .update({ lastReadId: caseExpression(trx, 'lastReadId', chunk) })

    return {
      rewritten: Number(rewritten ?? 0),
      markers: Number(markers ?? 0)
    }
  })

/**
 * Walks `notifications` by primary key and rewrites every id that is not
 * already a UUIDv7. With `dryRun` it only counts them.
 *
 * Rewritten rows move to a v7 id, which may sort ahead of the cursor; the walk
 * then reads them again and skips them as already v7, so every row is read at
 * most twice and the walk terminates. Rows that are already v7 are never
 * touched, which is what makes a re-run (or a resume after an interruption) a
 * no-op over finished rows.
 *
 * @param {import('knex').Knex} knex
 * @param {{ batchSize?: number, dryRun?: boolean, log?: (message: string) => void }} [options]
 * @returns {Promise<{ scanned: number, pending: number, rewritten: number, markers: number }>}
 */
export const rewriteNotificationIds = async (
  knex,
  {
    batchSize = NOTIFICATION_ID_BATCH_SIZE,
    dryRun = false,
    log = () => {}
  } = {}
) => {
  let lastId = ''
  let scanned = 0
  let pending = 0
  let rewritten = 0
  let markers = 0

  while (true) {
    const rows = await knex('notifications')
      .select('id', 'createdAt')
      .where('id', '>', lastId)
      .orderBy('id')
      .limit(batchSize)
    if (rows.length === 0) break

    lastId = rows[rows.length - 1].id
    scanned += rows.length

    const updates = rows
      .filter((row) => !isTimeOrderedNotificationId(row.id))
      .map((row) => ({ from: row.id, to: mintNotificationId(row.createdAt) }))
    pending += updates.length

    if (!dryRun) {
      for (
        let offset = 0;
        offset < updates.length;
        offset += UPDATE_CHUNK_SIZE
      ) {
        const result = await rewriteChunk(
          knex,
          updates.slice(offset, offset + UPDATE_CHUNK_SIZE)
        )
        rewritten += result.rewritten
        markers += result.markers
      }
    }

    log(
      `  notifications: ${scanned} scanned - ${pending} not time-ordered, ${rewritten} rewritten, ${markers} marker(s) repointed`
    )
  }

  return { scanned, pending, rewritten, markers }
}
