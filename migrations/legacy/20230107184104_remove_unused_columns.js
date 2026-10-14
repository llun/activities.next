/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) => {
  return knex.schema
    .alterTable('actors', function (table) {
      table.dropColumn('manuallyApprovesFollowers')
      table.dropColumn('discoverable')
      table.dropColumn('followerUrl')
      table.text('urls')
    })
    .dropTable('questions')
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => {
  return knex.schema.alterTable('actors', function (table) {
    table.boolean('manuallyApprovesFollowers')
    table.boolean('discoverable')
    table.string('followerUrl')
    table.dropColumn('urls')
  })
}
