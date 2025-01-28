/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('medias', function (table) {
    table.jsonb('originalMetaData')
    table.jsonb('thumbnailMetaData').nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('medias', function (table) {
    table.dropColumn('originalMetaData')
    table.dropColumn('thumbnailMetaData')
  })
}
