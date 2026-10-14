/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.transaction(async (trx) => {
    const hasApplicationName = await trx.schema.hasColumn(
      'statuses',
      'applicationName'
    )
    if (!hasApplicationName) {
      await trx.schema.alterTable('statuses', (table) => {
        table.string('applicationName').nullable()
        table.string('applicationWebsite').nullable()
      })
    }
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.transaction(async (trx) => {
    const hasApplicationName = await trx.schema.hasColumn(
      'statuses',
      'applicationName'
    )
    if (hasApplicationName) {
      await trx.schema.alterTable('statuses', (table) => {
        table.dropColumn('applicationWebsite')
        table.dropColumn('applicationName')
      })
    }
  })
}
