/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) => {
  return knex.schema.alterTable('follows', function (table) {
    table.string('inbox')
    table.string('sharedInbox')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => {
  return knex.schema.alterTable('follows', function (table) {
    table.dropColumn('inbox')
    table.dropColumn('sharedInbox')
  })
}
