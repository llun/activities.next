/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('fitness_files', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable().index()
    table.string('statusId').nullable().index()
    table.string('provider').notNullable()
    table.string('providerId').notNullable()
    table.string('activityType').nullable()
    table.string('filePath').notNullable()
    table.string('iconPath').notNullable()
    table.bigInteger('fileBytes').notNullable()
    table.bigInteger('iconBytes').notNullable()
    table.timestamps(true, true)

    table.foreign('actorId').references('id').inTable('actors')
    table.foreign('statusId').references('id').inTable('statuses').onDelete('CASCADE')
    table.unique(['provider', 'providerId', 'actorId'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('fitness_files')
}
