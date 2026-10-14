/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) => {
  return knex.schema.alterTable('poll_choices', function (table) {
    table.integer('totalVotes').unsigned().notNullable().defaultTo(0)
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => {
  return knex.schema.alterTable('poll_choices', function (table) {
    table.dropColumn('totalVotes')
  })
}
