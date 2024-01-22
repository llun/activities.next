/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.createTable('accountProviders', function (table) {
    table.string('id').primary()
    table.string('accountId')
    table.string('provider')
    table.string('providerId')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(
      ['accountId', 'provider', 'providerId'],
      'accountProvidersIndex'
    )
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.dropTable('accountProviders')
}
