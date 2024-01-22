/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.alterTable('medias', function (table) {
    table.string('accountId')
    table.string('mimeType')
    table.bigint('bytes').unsigned()

    table.index(['accountId', 'mimeType'], 'medias_accountId_mimeType_idx')
    table.index(['actorId', 'mimeType'], 'medias_actorId_mimeType_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('medias', function (table) {
    table.dropIndex(['accountId', 'mimeType'], 'medias_accountId_mimeType_idx')
    table.dropIndex(['actorId', 'mimeType'], 'medias_actorId_mimeType_idx')

    table.dropColumn('accountId')
    table.dropColumn('mimeType')
    table.dropColumn('bytes')
  })
}
