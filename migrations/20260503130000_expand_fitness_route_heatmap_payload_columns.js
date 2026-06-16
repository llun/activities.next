const usesMysqlTextTypes = (knex) => {
  const client = String(knex.client.config.client)
  return client.includes('mysql') || client.includes('maria')
}

const alterPayloadColumns = async (knex, columnType) => {
  const hasRouteHeatmaps = await knex.schema.hasTable('fitness_route_heatmaps')
  if (!hasRouteHeatmaps || !usesMysqlTextTypes(knex)) {
    return
  }

  const [hasBounds, hasSegments] = await Promise.all([
    knex.schema.hasColumn('fitness_route_heatmaps', 'bounds'),
    knex.schema.hasColumn('fitness_route_heatmaps', 'segments')
  ])

  if (!hasBounds && !hasSegments) {
    return
  }

  await knex.schema.alterTable('fitness_route_heatmaps', (table) => {
    if (hasBounds) {
      table.specificType('bounds', columnType).alter()
    }
    if (hasSegments) {
      table.specificType('segments', columnType).alter()
    }
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await alterPayloadColumns(knex, 'mediumtext')
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await alterPayloadColumns(knex, 'text')
}
