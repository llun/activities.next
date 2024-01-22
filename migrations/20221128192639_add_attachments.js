/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.createTable('attachments', function (table) {
    table.string('id').primary()
    table.string('statusId')
    table.string('url')
    table.string('mediaType')
    table.string('type')
    table.integer('width')
    table.integer('height')
    table.text('name')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['statusId', 'createdAt', 'updatedAt'], 'attachmentsIndex')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.dropTable('attachments')
}
