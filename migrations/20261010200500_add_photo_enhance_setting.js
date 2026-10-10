/**
 * AI enhance in the photo editor (phase 3). Additive only.
 *
 * `gallery_settings` gains `photoEnhance`: whether the owner's photo editor
 * may send a small preview of a photo to the instance's vision model for a
 * suggested edit. Default on; the AI tab only appears when the instance has a
 * model for it too. Nothing about the photo is stored by the request.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn(
    'gallery_settings',
    'photoEnhance'
  )
  if (!hasColumn) {
    await knex.schema.alterTable('gallery_settings', function (table) {
      table.boolean('photoEnhance').notNullable().defaultTo(true)
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn(
    'gallery_settings',
    'photoEnhance'
  )
  if (hasColumn) {
    await knex.schema.alterTable('gallery_settings', function (table) {
      table.dropColumn('photoEnhance')
    })
  }
}
