/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    // Why the route map is missing, when it was supposed to exist.
    //
    // Deliberately NOT `processingStatus: 'failed'` + `importError`: those mean
    // "this activity is not usable" and gate the status detail dashboard, the
    // post's stat grid, the fitness overview, the profile's Fitness tab and
    // every stats/heatmap rollup. An activity whose file parsed fine and whose
    // post federated is usable — only its map is missing — so the failure needs
    // its own signal or a tile-server outage hides hundreds of good imports.
    //
    // Nullable, and null is the norm: no GPS data, a route entirely inside a
    // privacy zone, and a map that rendered fine all leave it null. Cleared on
    // every successful (re)processing run.
    table.text('mapError')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.dropColumn('mapError')
  })
}
