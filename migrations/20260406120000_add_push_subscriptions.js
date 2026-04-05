/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('push_subscriptions', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.text('endpoint').notNullable()
    table.string('p256dh').notNullable()
    table.string('auth').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['actorId'], 'push_subscriptions_actor_idx')
    table.unique(['endpoint'], {
      indexName: 'push_subscriptions_endpoint_unique'
    })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('push_subscriptions')
}
