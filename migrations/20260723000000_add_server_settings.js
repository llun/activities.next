/**
 * Stores database-backed instance server settings as key/value rows. Backs the
 * admin server-settings pages (Instance, Posts & media, Network) and the
 * federation-policy block. Each row is one setting: `key` is the registry key
 * (e.g. `posts.maxCharacters`) and `value` holds its JSON-encoded value.
 *
 * The env -> database -> default resolver reads these rows; when the matching
 * environment variable is set it still wins and locks the field, so a row here
 * is only consulted for settings that are not pinned by the environment.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('server_settings', (table) => {
    table.string('key').primary()
    table.text('value').notNullable()
    table.timestamp('createdAt').notNullable()
    table.timestamp('updatedAt').notNullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('server_settings')
}
