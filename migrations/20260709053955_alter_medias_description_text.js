/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  // Mastodon allows media descriptions (alt text) up to 1,500 characters;
  // the original varchar(255) column made PostgreSQL reject anything longer.
  await knex.schema.alterTable('medias', function (table) {
    table.text('description').nullable().alter()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  // Best-effort rollback: PostgreSQL will refuse the narrowing if any stored
  // description is longer than 255 characters.
  await knex.schema.alterTable('medias', function (table) {
    table.string('description').nullable().alter()
  })
}
