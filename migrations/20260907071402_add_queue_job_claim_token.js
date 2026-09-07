/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.alterTable('queue_jobs', (table) => {
    table.string('claim_token', 255).nullable().defaultTo(null)
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.alterTable('queue_jobs', (table) => {
    table.dropColumn('claim_token')
  })
}
