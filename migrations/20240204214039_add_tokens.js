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

      table.string('clientId')
      table.string('actorId')
      table.string('accountId')

      table.jsonb('scopes')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
    })
    .renameTable('applications', 'clients')
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .renameTable('clients', 'applications')
    .alterTable('applications', function (table) {
      table.renameColumn('name', 'clientName')
    })
    .dropTable('tokens')
}
