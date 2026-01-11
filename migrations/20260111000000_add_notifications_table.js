/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.createTable('notifications', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('type').notNullable()
    table.string('sourceActorId').notNullable()
    table.string('statusId')
    table.string('followId')
    table.boolean('isRead').defaultTo(false)
    table.timestamp('readAt', { useTz: true })
    table.string('groupKey')
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['actorId', 'createdAt'], 'notifications_actor_created')
    table.index(
      ['actorId', 'isRead', 'createdAt'],
      'notifications_actor_unread'
    )
    table.index(['groupKey', 'createdAt'], 'notifications_group_key')
    table.index(['followId'], 'notifications_follow_id')
    table.index(['statusId'], 'notifications_status_id')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.dropTable('notifications')
}
