/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.createTable('blocks', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('actorHost').notNullable()
    table.string('targetActorId').notNullable()
    table.string('targetActorHost').notNullable()
    table.string('uri').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'targetActorId'], {
      indexName: 'blocks_actor_target_unique'
    })
    table.unique(['uri'], { indexName: 'blocks_uri_unique' })
    table.index(['actorId', 'createdAt'], 'blocks_actor_created')
    table.index(['targetActorId'], 'blocks_target')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => knex.schema.dropTable('blocks')
