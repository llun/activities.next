/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.boolean('isPrimary').notNullable().defaultTo(true)
    table.string('importBatchId')
    table.string('importStatus')
    table.text('importError')
    table.index('importBatchId', 'fitness_files_import_batch_id_idx')
  })

  await knex('fitness_files').update({
    isPrimary: true
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.dropIndex('importBatchId', 'fitness_files_import_batch_id_idx')
    table.dropColumn('isPrimary')
    table.dropColumn('importBatchId')
    table.dropColumn('importStatus')
    table.dropColumn('importError')
  })
}
