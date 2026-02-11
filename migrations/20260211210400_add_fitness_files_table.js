/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('fitness_files', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.foreign('actorId').references('id').inTable('actors')
    table.string('statusId')
    table.foreign('statusId').references('id').inTable('statuses').onDelete('SET NULL')

    // File information
    table.string('path').notNullable()
    table.string('fileName').notNullable()
    table.string('fileType').notNullable() // 'fit', 'gpx', 'tcx'
    table.string('mimeType').notNullable()
    table.bigInteger('bytes').notNullable()

    // Optional description
    table.text('description')

    // Map data flags
    table.boolean('hasMapData').defaultTo(false)
    table.string('mapImagePath') // Path to generated map image (if any)

    // Standard timestamps
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('deletedAt', { useTz: true })

    // Indexes
    table.index('actorId', 'fitness_files_actor_id_idx')
    table.index('statusId', 'fitness_files_status_id_idx')
    table.index(['actorId', 'createdAt'], 'fitness_files_actor_created_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('fitness_files')
}
