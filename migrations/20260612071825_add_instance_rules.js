/**
 * Stores the instance's moderation rules (Mastodon's "instance rules"). Backs
 * the public GET /api/v1/instance/rules endpoint (and the rules section of
 * /api/v2/instance) plus the admin management endpoints that create, reorder,
 * and delete rules.
 *
 * `position` drives the display order (ascending, with `createdAt` as a
 * stable tiebreaker), `text` is the rule itself, and `hint` is the optional
 * longer explanation Mastodon 4.3+ shows under the rule.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('instance_rules', (table) => {
    table.string('id').primary()
    table.integer('position').notNullable().defaultTo(0)
    table.text('text').notNullable()
    table.text('hint').notNullable().defaultTo('')
    table.timestamp('createdAt').notNullable()
    table.timestamp('updatedAt').notNullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('instance_rules')
}
