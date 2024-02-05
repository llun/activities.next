/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('applications', function (table) {
      table.renameColumn('clientName', 'name')
    })
    .createTable('tokens', function (table) {
      table.string('accessToken').primary()
      table.string('refreshToken').nullable()

      table.timestamp('accessTokenExpiresAt', { useTz: true })
      table.timestamp('refreshTokenExpiresAt', { useTz: true }).nullable()

      table.string('applicationId')
      table.string('accountId')

      table.json('scopes')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
    })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .alterTable('applications', function (table) {
      table.renameColumn('name', 'clientName')
    })
    .dropTable('tokens')
}
