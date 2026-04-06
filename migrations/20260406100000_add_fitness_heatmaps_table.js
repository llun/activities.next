/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('fitness_heatmaps', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable().references('id').inTable('actors')
    table.string('activityType')
    table.string('periodType').notNullable()
    table.string('periodKey').notNullable()
    table.timestamp('periodStart', { useTz: true })
    table.timestamp('periodEnd', { useTz: true })
    table.string('imagePath')
    table.string('status').notNullable().defaultTo('pending')
    table.text('error')
    table.integer('activityCount').notNullable().defaultTo(0)
    table.timestamp('createdAt', { useTz: true }).notNullable()
    table.timestamp('updatedAt', { useTz: true }).notNullable()
    table.timestamp('deletedAt', { useTz: true })

    table.unique(['actorId', 'activityType', 'periodType', 'periodKey'])
    table.index(['actorId', 'status'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('fitness_heatmaps')
}
