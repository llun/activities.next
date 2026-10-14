/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
  return knex.schema.alterTable('recipients', function (table) {
    table.index(['type', 'actorId'], 'recipientsTypeActorIdIndex')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function (knex) {
  return knex.schema.alterTable('recipients', function (table) {
    table.dropIndex(['type', 'actorId'], 'recipientsTypeActorIdIndex')
  })
}
