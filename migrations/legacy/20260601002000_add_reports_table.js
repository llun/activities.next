/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.createTable('reports', (table) => {
    table.string('id').primary()
    // Reporter (local actor) and the reported account.
    table.string('actorId').notNullable()
    table.string('targetActorId').notNullable()
    // Mastodon report category: 'spam' | 'legal' | 'violation' | 'other'
    table.string('category').notNullable().defaultTo('other')
    table.text('comment').notNullable().defaultTo('')
    table.boolean('forward').notNullable().defaultTo(false)
    // JSON-encoded array of reported status IDs and rule IDs.
    table.text('statusIds').notNullable().defaultTo('[]')
    table.text('ruleIds').notNullable().defaultTo('[]')
    table.boolean('actionTaken').notNullable().defaultTo(false)
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['actorId', 'createdAt'], 'reports_actor_created')
    table.index(['targetActorId'], 'reports_target')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => knex.schema.dropTableIfExists('reports')
