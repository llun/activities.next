import { rewriteNotificationIds } from '../lib/database/sql/notificationIdRewrite.js'

/**
 * Rewrites every notification id that is not already a UUIDv7 into a UUIDv7
 * minted from that row's `createdAt`, and repoints the notifications read
 * marker (`markers.lastReadId`) at the rewritten id. The walk itself lives in
 * lib/database/sql/notificationIdRewrite.js, shared with the post-rollout
 * script scripts/maintenance/rewriteNotificationIds.ts.
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
 * `notifications` timeline. A marker on a rewritten row follows it; a marker on
 * a non-v7 id that names no notification (dismissed or cleared earlier) is
 * reset to the highest v7 id for the millisecond it was last written. A
 * notification's group key falls back to its id
 * (`groupKey || id`, `ungrouped-<id>`) only when it is serialized; nothing
 * persists that fallback, so there is nothing else to repoint.
 *
 * DEPLOY ORDER AND RESIDUE. `yarn migrate` runs from a checkout against the
 * live database while the PREVIOUS image keeps serving traffic (see
 * migrations/20260808000000_add_public_ids.js and docs/postgresql-setup.md),
 * and that image still mints v4 ids. Rows it inserts behind this migration's
 * cursor, or after the walk finishes and until the rollout completes, keep a
 * v4 id, and knex never re-runs a recorded migration. Those rows do NOT age
 * out: a v4 id almost always sorts above every v7 id, so an id-ordering client
 * pins them to the top of the list for good and may set its notifications
 * marker to one of them. Run scripts/maintenance/rewriteNotificationIds.ts once
 * the rollout has completed (see docs/maintenance.md) to rewrite them.
 *
 * Ids a client cached before this ran (a notification id, a pagination cursor,
 * an `ungrouped-<id>` group key) stop resolving once the row is rewritten,
 * except the server-side marker, which is repointed here; see
 * docs/mastodon-api-compatibility.md for what such a client sees.
 *
 * On PostgreSQL a chunk's UPDATE can deadlock with a concurrent app write to
 * the same rows; PostgreSQL then aborts one side, and if it is this migration it
 * fails unrecorded, so re-running `yarn migrate` resumes cleanly.
 */

export const config = { transaction: false }

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const totalResult = await knex('notifications').count('* as cnt').first()
  console.log(
    `Rewriting notification ids for ${Number(totalResult.cnt)} notifications...`
  )

  const { rewritten, markers, orphanMarkers } = await rewriteNotificationIds(
    knex,
    {
      log: (message) => console.log(message)
    }
  )

  console.log(
    `Done. notifications: ${rewritten} id(s) rewritten to UUIDv7, ${markers} notifications marker(s) repointed, ${orphanMarkers} orphan notifications marker(s) reset.`
  )
  console.log(
    '  The previous build keeps writing random (v4) notification ids until the rollout completes, and those sort above every time-ordered id in clients that order by id.'
  )
  console.log(
    '  After the rollout completes, rewrite them with `scripts/maintenance/rewriteNotificationIds.ts` (see docs/maintenance.md) - re-running `yarn migrate` will NOT, since this migration is already recorded.'
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
