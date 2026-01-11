/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  // Check for existing rows before deleting
  const result = await knex('poll_answers').count('* as count').first()
  const count = result ? parseInt(result.count, 10) : 0

  if (count > 0) {
    console.warn(
      `⚠️  Deleting ${count} orphaned poll_answers (missing statusId before this migration)`
    )
  }

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
