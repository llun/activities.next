/**
 * Photos and videos added to the gallery without a post (PR 2 of the media
 * gallery, "Add to gallery").
 *
 * `medias.galleryAddedAt` is set when the owner confirms an upload in
 * Gallery > All media > Add. It tells a kept gallery upload apart from an
 * upload the composer abandoned (both are `medias` rows with no attachment):
 * the owner's gallery scope is "posted, or `galleryAddedAt` is not null". A
 * row that never has it set behaves exactly as before, and nothing is written
 * for existing rows, so the column is nullable with no default and no backfill.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('medias', 'galleryAddedAt')
  if (!hasColumn) {
    await knex.schema.alterTable('medias', function (table) {
      table.timestamp('galleryAddedAt', { useTz: true }).nullable()
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('medias', 'galleryAddedAt')
  if (hasColumn) {
    await knex.schema.alterTable('medias', function (table) {
      table.dropColumn('galleryAddedAt')
    })
  }
}
