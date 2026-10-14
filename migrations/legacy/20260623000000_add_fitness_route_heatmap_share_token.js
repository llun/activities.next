/**
 * Adds an opt-in public share token to route heatmaps. When set, the heatmap is
 * reachable through the unauthenticated `/embed/heatmap/<token>` surface; when
 * null (the default) the heatmap stays private. The token is unique so a single
 * token resolves to exactly one heatmap; NULLs are distinct in both SQLite and
 * Postgres unique indexes, so unshared rows do not collide.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('fitness_route_heatmaps')
  if (!hasTable) return

  const hasColumn = await knex.schema.hasColumn(
    'fitness_route_heatmaps',
    'shareToken'
  )
  if (hasColumn) return

  await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
    table.string('shareToken')
    table.unique(['shareToken'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasTable = await knex.schema.hasTable('fitness_route_heatmaps')
  if (!hasTable) return

  const hasColumn = await knex.schema.hasColumn(
    'fitness_route_heatmaps',
    'shareToken'
  )
  if (!hasColumn) return

  await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
    table.dropUnique(['shareToken'])
    table.dropColumn('shareToken')
  })
}
