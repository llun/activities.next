/**
 * Add productUrl to fitness_gear_components so bicycle components (e.g. chains,
 * cassettes, tires) can store and display a link to the manufacturer or product page.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  const hasProductUrl = await knex.schema.hasColumn(
    'fitness_gear_components',
    'productUrl'
  )
  if (!hasProductUrl) {
    await knex.schema.alterTable('fitness_gear_components', function (table) {
      table.string('productUrl', 255).nullable()
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  const hasProductUrl = await knex.schema.hasColumn(
    'fitness_gear_components',
    'productUrl'
  )
  if (hasProductUrl) {
    await knex.schema.alterTable('fitness_gear_components', function (table) {
      table.dropColumn('productUrl')
    })
  }
}
