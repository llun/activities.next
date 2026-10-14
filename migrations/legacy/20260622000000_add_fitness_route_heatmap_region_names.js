/**
 * Adds `fitness_route_heatmap_region_names`, a per-`(actorId, region)` store for
 * the user-facing label of a route-heatmap region. The label is intentionally
 * NOT part of the serialized region cache key (see `lib/fitness/regions`), so it
 * needs its own home to survive reloads — otherwise a region rediscovered from
 * its heatmap renders as the generic "Map area".
 *
 * The name is region-scoped (one per region, independent of activity/period and
 * of the heatmap-generation lifecycle), so it lives in its own table rather than
 * being denormalized across the `fitness_route_heatmaps` rows.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable(
    'fitness_route_heatmap_region_names'
  )
  if (hasTable) {
    return
  }

  await knex.schema.createTable(
    'fitness_route_heatmap_region_names',
    function (table) {
      table
        .string('actorId')
        .notNullable()
        .references('id')
        .inTable('actors')
        .onDelete('CASCADE')
      table.string('region').notNullable()
      table.string('name').notNullable()
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('updatedAt', { useTz: true }).notNullable()

      table.primary(['actorId', 'region'])
    }
  )
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.dropTableIfExists('fitness_route_heatmap_region_names')
}
