import { v7 } from 'uuid'

/**
 * Rewrites every notification id that is not already a UUIDv7 into a UUIDv7
 * minted from that row's `createdAt`, and repoints the notifications read
 * marker (`markers.lastReadId`) at the rewritten id.
 *
 * WHY. Mastodon notification ids are time-ordered snowflakes, and clients sort
 * the notification list — and compare the notifications marker — by id. This
 * instance used to mint notification ids with crypto.randomUUID() (v4, random),
 * so a client that orders by id (Ivory) showed the list in a random order.
 * createNotification now mints a UUIDv7 from createdAt, the same scheme the
 * status/actor `publicId` uses, which sorts chronologically as a plain string;
 * this migration brings the existing rows into line.
 *
 * WHAT ELSE STORES A NOTIFICATION ID. Only `markers.lastReadId` for the
 * `notifications` timeline. A notification's group key falls back to its id
 * (`groupKey || id`, `ungrouped-<id>`) only when it is serialized; nothing
 * persists that fallback, so there is nothing else to repoint.
 *
 * DEPLOY ORDER AND RESIDUE. `yarn migrate` runs from a checkout against the
 * live database while the PREVIOUS image keeps serving traffic (see
 * migrations/20260808000000_add_public_ids.js and docs/postgresql-setup.md),
 * and that image still mints v4 ids. Rows it inserts behind this migration's
 * cursor, or after the walk finishes and until the rollout completes, keep a
 * v4 id; nothing rewrites them later, since knex never re-runs a recorded
 * migration. That residue is a handful of notifications written during the
 * rollout window. They still work everywhere — an id is an opaque string to
 * every query — they just sort out of place in an id-ordering client until
 * they age out of its list. This is accepted rather than worked around.
 *
 * Ids a client cached before this ran (a notification id, a pagination cursor,
 * an `ungrouped-<id>` group key) stop resolving once the row is rewritten,
 * except the server-side marker, which is repointed here. A client recovers by
 * reloading its notification list from the top.
 */

export const config = { transaction: false }

// Same strict shape as isPublicId() in lib/utils/publicId.ts: version nibble 7
// and RFC 4122 variant [89ab]. The knex CLI resolves no `@/` aliases and
// compiles no TypeScript, so the pattern is repeated rather than imported.
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

// SQLite hands back `createdAt` as a naive UTC string ('2024-03-04 05:06:07')
// for rows written by the CURRENT_TIMESTAMP default, which `new Date` would read
// as LOCAL time; PostgreSQL hands back a Date. Mirrors toDate() in
// 20260808000000_add_public_ids.js.
const toDate = (value) => {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed
    return new Date(normalized)
  }
  return new Date(value)
}

// Mirrors generatePublicId(createdAt) in lib/utils/publicId.ts, which is what
// createNotification now uses, so a rewritten row is indistinguishable from a
// new one.
const mintNotificationId = (createdAt) => {
  const time = toDate(createdAt).getTime()
  const msecs = Number.isFinite(time) && time >= 0 ? Math.floor(time) : 0
  return v7({ msecs })
}

const BATCH_SIZE = 500

// Rows folded into one bulk UPDATE. Each row contributes three bind parameters
// (the CASE match, the CASE value and the id in the IN list), so 200 rows is
// 600 parameters — under the 999-parameter floor of the most conservatively
// built SQLite, and nowhere near PostgreSQL's 65535.
const UPDATE_CHUNK_SIZE = 200

const caseExpression = (knex, column, chunk) =>
  knex.raw(
    `case ?? ${chunk.map(() => 'when ? then ?').join(' ')} else ?? end`,
    [column, ...chunk.flatMap(({ from, to }) => [from, to]), column]
  )

// One chunk is rewritten in its own short transaction so the notification ids
// and the marker that points at them move together. Were the two UPDATEs to
// commit separately, an interruption between them would leave the marker on an
// old id that a resumed run can never repoint: the row it named is already v7
// and is skipped. Chunks are awaited one at a time, so the migration holds
// exactly ONE pooled connection and leaves the rest of the pool to the app
// serving traffic alongside it (see bulkUpdatePublicIds() in
// 20260808000000_add_public_ids.js for the pool exhaustion this avoids).
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
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const totalResult = await knex('notifications').count('* as cnt').first()
  const total = Number(totalResult.cnt)
  console.log(`Rewriting notification ids for ${total} notifications...`)

  // Forward keyset walk on the primary key. Rewritten rows move to a v7 id,
  // which may sort ahead of the cursor; the walk then reads them again and
  // skips them as already v7, so every row is read at most twice and the walk
  // terminates. Rows that are already v7 are never touched, which is what makes
  // a re-run (or a resume after an interruption) a no-op over finished rows.
  let lastId = ''
  let scanned = 0
  let rewritten = 0
  let markers = 0

  while (true) {
    const rows = await knex('notifications')
      .select('id', 'createdAt')
      .where('id', '>', lastId)
      .orderBy('id')
      .limit(BATCH_SIZE)
    if (rows.length === 0) break

    lastId = rows[rows.length - 1].id
    scanned += rows.length

    const updates = rows
      .filter((row) => !UUID_V7_PATTERN.test(row.id))
      .map((row) => ({ from: row.id, to: mintNotificationId(row.createdAt) }))

    for (let offset = 0; offset < updates.length; offset += UPDATE_CHUNK_SIZE) {
      const result = await rewriteChunk(
        knex,
        updates.slice(offset, offset + UPDATE_CHUNK_SIZE)
      )
      rewritten += result.rewritten
      markers += result.markers
    }

    console.log(
      `  notifications: ${scanned} scanned - ${rewritten} rewritten, ${markers} marker(s) repointed`
    )
  }

  console.log(
    `Done. notifications: ${rewritten} id(s) rewritten to UUIDv7, ${markers} notifications marker(s) repointed.`
  )
  console.log(
    '  Notifications the previous build writes until the rollout completes keep a random (v4) id; they work normally but may sort out of place in clients that order by id until they age out.'
  )
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (_knex) {
  // Nothing to undo. A UUIDv7 is as valid an opaque notification id as the v4
  // it replaced, and the v4 values are not kept, so they could not be restored
  // anyway.
}
