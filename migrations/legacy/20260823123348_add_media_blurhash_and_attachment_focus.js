/**
 * Adds blurhash to `medias`, and blurhash, focal-point, and thumbnailUrl
 * columns to `attachments` so that image and video attachments can persist
 * placeholder hashes, focal points, and thumbnail URLs.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('medias', function (table) {
    table.string('blurhash', 255).nullable()
  })

  await knex.schema.alterTable('attachments', function (table) {
    table.string('blurhash', 255).nullable()
    table.double('focusX').nullable()
    table.double('focusY').nullable()
    table.string('thumbnailUrl', 255).nullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('attachments', function (table) {
    table.dropColumn('blurhash')
    table.dropColumn('focusX')
    table.dropColumn('focusY')
    table.dropColumn('thumbnailUrl')
  })

  await knex.schema.alterTable('medias', function (table) {
    table.dropColumn('blurhash')
  })
}
