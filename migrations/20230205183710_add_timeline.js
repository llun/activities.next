/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.createTable('timelines', function (table) {
    table.increments('id').primary()
    table.string('actorId')
    table.string('timeline')
    table.string('statusId')
    table.string('statusActorId')

    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'timeline', 'statusId'], {
      indexName: 'actor_timeline_status'
    })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.dropTable('timelines')
}
