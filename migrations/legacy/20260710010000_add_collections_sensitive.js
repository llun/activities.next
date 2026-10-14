/**
 * Adds the Mastodon 4.6 `sensitive` flag to collections. The final 4.6
 * Collection entity carries a per-collection sensitive-content marker with no
 * existing storage in the pre-final schema, so store it verbatim to let
 * POST/PATCH `sensitive` round-trip through the API. Defaults to false for
 * every existing row.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('collections')
  if (!hasTable) return

  const hasColumn = await knex.schema.hasColumn('collections', 'sensitive')
  if (hasColumn) return

  await knex.schema.alterTable('collections', (table) => {
    table.boolean('sensitive').notNullable().defaultTo(false)
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasTable = await knex.schema.hasTable('collections')
  if (!hasTable) return

  const hasColumn = await knex.schema.hasColumn('collections', 'sensitive')
  if (!hasColumn) return

  await knex.schema.alterTable('collections', (table) => {
    table.dropColumn('sensitive')
  })
}
