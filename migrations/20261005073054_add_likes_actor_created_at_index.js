// Indexes `likes` for GET /api/v1/favourites.
//
// `likes` only had its primary key (statusId, actorId). `getLikes` filters on
// `actorId` and orders by `createdAt DESC, statusId DESC` (keyset-paginated), so
// `actorId` is not the primary key's leading column and every page — and up to
// five backfill passes per request — scanned and sorted the whole table.
//
// Column order follows the "constrain-first" rule: `actorId` is pinned by every
// caller, then `createdAt, statusId` match the ORDER BY and the cursor
// comparison, so a page is a bounded index range read with no sort and
// `LIMIT` stops early.
//
// `CREATE INDEX` blocks writes to `likes` while it builds, like every other
// index migration here.

const INDEX_NAME = 'likes_actor_created_at_status_idx'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
  return knex.schema.alterTable('likes', function (table) {
    table.index(['actorId', 'createdAt', 'statusId'], INDEX_NAME)
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function (knex) {
  return knex.schema.alterTable('likes', function (table) {
    table.dropIndex(['actorId', 'createdAt', 'statusId'], INDEX_NAME)
  })
}
