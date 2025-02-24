/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('timelines', function (table) {
    table.index(['timeline', 'statusId'], 'timelinesTimelineStatusIdIndex')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('timelines', function (table) {
    table.dropIndex(['timeline', 'statusId'], 'timelinesTimelineStatusIdIndex')
  })
}
