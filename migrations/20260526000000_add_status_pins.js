const STATUS_PINS_TABLE = 'status_pins'

exports.up = async (knex) => {
  await knex.schema.createTable(STATUS_PINS_TABLE, (table) => {
    table.string('actorId').notNullable()
    table.string('statusId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'statusId'], {
      indexName: 'status_pins_actor_status_unique'
    })
    table.index(
      ['actorId', 'createdAt', 'statusId'],
      'status_pins_actor_created_status'
    )
    table.index(['statusId'], 'status_pins_status')
  })
}

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists(STATUS_PINS_TABLE)
}
