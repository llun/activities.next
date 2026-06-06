exports.up = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    // External source URL the activity was imported from (e.g. the original
    // Strava activity page). Kept as a record so the link can be surfaced on
    // the fitness activity display instead of being embedded in the status
    // text content.
    table.text('sourceUrl')
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.dropColumn('sourceUrl')
  })
}
