/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable('lists', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('title').notNullable()
    // Mastodon RepliesPolicy: 'followed' | 'list' | 'none'
    table.string('repliesPolicy').notNullable().defaultTo('list')
    table.boolean('exclusive').notNullable().defaultTo(false)
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['actorId', 'createdAt'], 'lists_actor_created')
  })

  await knex.schema.createTable('list_accounts', (table) => {
    table.string('id').primary()
    table.string('listId').notNullable()
    table.string('actorId').notNullable()
    table.string('targetActorId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['listId', 'targetActorId'], {
      indexName: 'list_accounts_list_target_unique'
    })
    // No separate index on listId: it is the leftmost column of the composite
    // unique index above, which already serves listId-prefixed lookups.
    table.index(['targetActorId'], 'list_accounts_target')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('list_accounts')
  await knex.schema.dropTableIfExists('lists')
}
