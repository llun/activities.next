// FROZEN FOR MIGRATION 20261009163215_time_ordered_notification_ids. That
// migration imports this module, and knex re-runs it on every fresh database,
// so any change here must stay valid against the schema as of that migration
// (the `notifications` and `markers` tables and columns it reads and writes),
// not just against today's schema.
//
// Rewrites notification ids that are not time-ordered (UUIDv4, from before
// createNotification minted UUIDv7s) into UUIDv7s minted from each row's
// createdAt, and repoints the `notifications` read marker at the new id.
// Notifications markers left on a non-v7 id that names no notification at all
// are repaired too (see repairOrphanNotificationsMarkers).
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
 * The highest-sorting UUIDv7 for one millisecond: the 48-bit timestamp, then
 * every remaining bit set (version 7, variant `b`). As a notifications marker
 * it reads as "everything created up to and including this millisecond is
 * read", because every notification id minted in that millisecond or earlier
 * sorts at or below it, and every later one above it.
 *
 * @param {number} msecs
 * @returns {string}
 */
export const getMaxTimeOrderedIdForMs = (msecs) => {
  const clamped =
    Number.isFinite(msecs) && msecs >= 0
      ? Math.min(Math.floor(msecs), 0xffffffffffff)
      : 0
  const hex = clamped.toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7fff-bfff-ffffffffffff`
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

const MARKER_LOOKUP_CHUNK_SIZE = 500

// A notifications marker whose lastReadId is not a UUIDv7 and names no
// notification at all — its notification was dismissed or cleared before the
// rewrite, or a client stored a stale id the rewrite never saw — cannot be
// repointed through a rewritten row, yet a v4 id sorts above every v7 id: an
// id-comparing client then treats every new notification as read, and clients
// that only ever move the marker forward never move it back. Such a marker is
// set to the highest v7 id for the millisecond it was last written, which keeps
// its meaning ("read up to then") in the time-ordered id space.
//
// Run after the walk, so a marker pointing at a row the walk just rewrote has
// already been repointed to that row and is not an orphan. Markers are one row
// per actor and timeline, so loading them is cheap.
/**
 * @param {import('knex').Knex} knex
 * @param {{ dryRun: boolean }} options
 * @returns {Promise<number>} how many orphan markers were found (and, unless
 *   dryRun, repaired)
 */
const repairOrphanNotificationsMarkers = async (knex, { dryRun }) => {
  const candidates = (
    await knex('markers')
      .select('id', 'lastReadId', 'updatedAt')
      .where('timeline', 'notifications')
  ).filter((marker) => !isTimeOrderedNotificationId(marker.lastReadId))
  if (candidates.length === 0) return 0

  const existing = new Set()
  const ids = [...new Set(candidates.map((marker) => marker.lastReadId))]
  for (
    let offset = 0;
    offset < ids.length;
    offset += MARKER_LOOKUP_CHUNK_SIZE
  ) {
    const rows = await knex('notifications')
      .select('id')
      .whereIn('id', ids.slice(offset, offset + MARKER_LOOKUP_CHUNK_SIZE))
    for (const row of rows) existing.add(row.id)
  }

  const orphans = candidates.filter(
    (marker) => !existing.has(marker.lastReadId)
  )
  if (dryRun) return orphans.length

  for (const marker of orphans) {
    await knex('markers')
      .where({ id: marker.id, lastReadId: marker.lastReadId })
      .update({
        lastReadId: getMaxTimeOrderedIdForMs(toDate(marker.updatedAt).getTime())
      })
  }
  return orphans.length
}

/**
 * Walks `notifications` by primary key and rewrites every id that is not
 * already a UUIDv7, then repairs orphan notifications markers. With `dryRun`
 * it only counts both.
 *
 * Rewritten rows move to a v7 id, which may sort ahead of the cursor; the walk
 * then reads them again and skips them as already v7, so every row is read at
 * most twice and the walk terminates. Rows that are already v7 are never
 * touched, which is what makes a re-run (or a resume after an interruption) a
 * no-op over finished rows.
 *
 * @param {import('knex').Knex} knex
 * @param {{ batchSize?: number, dryRun?: boolean, log?: (message: string) => void }} [options]
 * @returns {Promise<{ scanned: number, pending: number, rewritten: number, markers: number, orphanMarkers: number }>}
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

  const orphanMarkers = await repairOrphanNotificationsMarkers(knex, {
    dryRun
  })
  if (orphanMarkers > 0) {
    log(
      `  markers: ${orphanMarkers} notifications marker(s) on an id that names no notification${dryRun ? '' : ', reset to the newest time-ordered id for when they were last written'}`
    )
  }

  return { scanned, pending, rewritten, markers, orphanMarkers }
}
