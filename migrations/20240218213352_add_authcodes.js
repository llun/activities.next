/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('auth_codes', function (table) {
    table.string('code').primary()

    table.string('redirectUri').nullable()
    table.string('codeChallenge').nullable()
    table.string('codeChallengeMethod').nullable()

    table.string('clientId')
    table.string('actorId')
    table.string('accountId')

    table.jsonb('scopes')

    table.timestamp('expiresAt', { useTz: true })
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('auth_codes')
}
