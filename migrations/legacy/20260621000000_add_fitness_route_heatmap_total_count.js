/**
 * Adds `totalCount` to `fitness_route_heatmaps` so generation can report
 * progress (files processed out of the total matching files). The column is
 * additive and defaults to 0; the generation job backfills the real total on
 * its first pass for each run.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasRouteHeatmaps = await knex.schema.hasTable('fitness_route_heatmaps')
  if (!hasRouteHeatmaps) {
    return
  }

  const hasTotalCount = await knex.schema.hasColumn(
    'fitness_route_heatmaps',
    'totalCount'
  )

  if (!hasTotalCount) {
    await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
      table.integer('totalCount').notNullable().defaultTo(0)
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasRouteHeatmaps = await knex.schema.hasTable('fitness_route_heatmaps')
  if (!hasRouteHeatmaps) {
    return
  }

  const hasTotalCount = await knex.schema.hasColumn(
    'fitness_route_heatmaps',
    'totalCount'
  )

  if (hasTotalCount) {
    await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
      table.dropColumn('totalCount')
    })
  }
}
