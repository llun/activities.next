/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    // Path of a JPEG copy of the route map in `mapImagePath`, kept for the
    // activity-import email. Every stored image is WebP, which Outlook desktop
    // (Word rendering engine) and Windows Mail cannot decode, so those
    // recipients saw the alt text instead of their route. Nullable: an activity
    // with no GPS data has no map at all, and every activity imported before
    // this column existed has no JPEG copy — those emails keep pointing at the
    // WebP.
    table.string('mapImageEmailPath')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.dropColumn('mapImageEmailPath')
  })
}
