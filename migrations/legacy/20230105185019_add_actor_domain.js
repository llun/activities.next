/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) => {
  return knex.schema.alterTable('actors', function (table) {
    table.renameColumn('preferredUsername', 'username')
    table.string('domain')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => {
  return knex.schema.alterTable('actors', function (table) {
    table.renameColumn('username', 'preferredUsername')
    table.dropColumn('domain')
  })
}
