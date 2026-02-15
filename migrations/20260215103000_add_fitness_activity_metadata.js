/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.string('processingStatus').defaultTo('pending')
    table.float('totalDistanceMeters')
    table.float('totalDurationSeconds')
    table.float('elevationGainMeters')
    table.string('activityType')
    table.timestamp('activityStartTime', { useTz: true })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.dropColumn('processingStatus')
    table.dropColumn('totalDistanceMeters')
    table.dropColumn('totalDurationSeconds')
    table.dropColumn('elevationGainMeters')
    table.dropColumn('activityType')
    table.dropColumn('activityStartTime')
  })
}
