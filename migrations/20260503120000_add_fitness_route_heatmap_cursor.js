/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
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
 * @returns { Promise<void> }
 */
export const down = async function () {
  // No-op: cursorOffset is now owned by the baseline route heatmap schema.
  // This migration only backfills older route-cache tables that were created
  // before the baseline included checkpoint progress.
}
