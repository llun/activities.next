/**
 * Index supporting the per-member purge of materialized list feeds
 * (removeListAccounts / actor deletion): delete from `timelines` where
 * (actorId, timeline) identify a list partition and statusActorId is the
 * removed member. The existing (actorId, timeline, createdAt) index narrows to
 * the whole partition but cannot seek by statusActorId.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('timelines', function (table) {
    table.index(
      ['actorId', 'timeline', 'statusActorId'],
      'timelinesActorTimelineStatusActorIndex'
    )
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('timelines', function (table) {
    table.dropIndex(
      ['actorId', 'timeline', 'statusActorId'],
      'timelinesActorTimelineStatusActorIndex'
    )
  })
}
