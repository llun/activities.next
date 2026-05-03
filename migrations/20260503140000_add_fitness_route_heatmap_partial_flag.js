/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasRouteHeatmaps = await knex.schema.hasTable('fitness_route_heatmaps')
  if (!hasRouteHeatmaps) {
    return
  }

  const hasIsPartial = await knex.schema.hasColumn(
    'fitness_route_heatmaps',
    'isPartial'
  )

  if (!hasIsPartial) {
    await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
      table.boolean('isPartial').notNullable().defaultTo(false)
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasRouteHeatmaps = await knex.schema.hasTable('fitness_route_heatmaps')
  if (!hasRouteHeatmaps) {
    return
  }

  const hasIsPartial = await knex.schema.hasColumn(
    'fitness_route_heatmaps',
    'isPartial'
  )

  if (hasIsPartial) {
    await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
      table.dropColumn('isPartial')
    })
  }
}
