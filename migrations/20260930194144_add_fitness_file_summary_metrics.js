/**
 * Add fitness summary metrics (avgPower, maxPower, avgHeartRate, maxHeartRate,
 * totalWorkKj) and elevationSeries to fitness_files table so activity detail
 * pages can render them immediately in SSR without fetching route-data.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasAvgPower = await knex.schema.hasColumn('fitness_files', 'avgPower')
  if (!hasAvgPower) {
    await knex.schema.alterTable('fitness_files', function (table) {
      table.integer('avgPower').nullable()
      table.integer('maxPower').nullable()
      table.integer('avgHeartRate').nullable()
      table.integer('maxHeartRate').nullable()
      table.integer('totalWorkKj').nullable()
      table.text('elevationSeries').nullable()
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasAvgPower = await knex.schema.hasColumn('fitness_files', 'avgPower')
  if (hasAvgPower) {
    await knex.schema.alterTable('fitness_files', function (table) {
      table.dropColumn('elevationSeries')
      table.dropColumn('totalWorkKj')
      table.dropColumn('maxHeartRate')
      table.dropColumn('avgHeartRate')
      table.dropColumn('maxPower')
      table.dropColumn('avgPower')
    })
  }
}
