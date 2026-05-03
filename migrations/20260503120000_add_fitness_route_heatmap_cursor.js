/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasRouteHeatmaps = await knex.schema.hasTable('fitness_route_heatmaps')
  if (!hasRouteHeatmaps) {
    return
  }

  const hasCursorOffset = await knex.schema.hasColumn(
    'fitness_route_heatmaps',
    'cursorOffset'
  )

  if (!hasCursorOffset) {
    await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
      table.integer('cursorOffset').notNullable().defaultTo(0)
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

  const hasCursorOffset = await knex.schema.hasColumn(
    'fitness_route_heatmaps',
    'cursorOffset'
  )

  if (hasCursorOffset) {
    await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
      table.dropColumn('cursorOffset')
    })
  }
}
