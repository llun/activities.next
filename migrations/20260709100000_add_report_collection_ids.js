/**
 * Mastodon 4.6 reports accept collection_ids[]; store them alongside the
 * reported status ids as a JSON-encoded array, matching statusIds/ruleIds.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.alterTable('reports', (table) => {
    table.text('collectionIds').notNullable().defaultTo('[]')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) =>
  knex.schema.alterTable('reports', (table) => {
    table.dropColumn('collectionIds')
  })
