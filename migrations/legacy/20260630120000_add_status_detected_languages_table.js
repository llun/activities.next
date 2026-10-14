/**
 * Content-detected language for statuses, kept separate from the declared
 * `language` stored inside `statuses.content`. One row per status, upserted
 * whenever the body is (re)analyzed; absence means detection hasn't run or
 * was inconclusive (short/ambiguous text).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.createTable('status_detected_languages', (table) => {
    table.string('statusId', 255).notNullable()
    table.string('language', 16).notNullable()
    table.float('confidence')
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.primary(['statusId'])
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => knex.schema.dropTable('status_detected_languages')
