const STATUS_PINS_TABLE = 'status_pins'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable(STATUS_PINS_TABLE, (table) => {
    table
      .string('actorId')
      .notNullable()
      .references('id')
      .inTable('actors')
      .onDelete('CASCADE')
    table
      .string('statusId')
      .notNullable()
      .references('id')
      .inTable('statuses')
      .onDelete('CASCADE')
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.primary(['actorId', 'statusId'])
    table.index(
      ['actorId', 'createdAt', 'statusId'],
      'status_pins_actor_created_status'
    )
    table.index(['statusId'], 'status_pins_status')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists(STATUS_PINS_TABLE)
}
