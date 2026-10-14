/**
 * Adds focal-point columns to `medias` so the Mastodon-compatible media API can
 * persist `meta.focus` ({ x, y }, each in [-1.0, 1.0]). Stored as two nullable
 * `double` columns (SQLite + PostgreSQL + MySQL compatible). `double` avoids the
 * float32 rounding that `float` introduces, so values round-trip exactly.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
  return knex.schema.alterTable('medias', function (table) {
    table.double('focusX').nullable()
    table.double('focusY').nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function (knex) {
  return knex.schema.alterTable('medias', function (table) {
    table.dropColumn('focusX')
    table.dropColumn('focusY')
  })
}
