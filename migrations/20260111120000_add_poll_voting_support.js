/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex('poll_answers').delete()
  return knex.schema.alterTable('poll_answers', function (table) {
    table.string('statusId').notNullable()
    table.index(['statusId', 'actorId'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.alterTable('poll_answers', function (table) {
    table.dropIndex(['statusId', 'actorId'])
    table.dropColumn('statusId')
  })
}
