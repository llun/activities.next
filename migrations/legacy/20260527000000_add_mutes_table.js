/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.createTable('mutes', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('actorHost').notNullable()
    table.string('targetActorId').notNullable()
    table.string('targetActorHost').notNullable()
    table.boolean('notifications').notNullable().defaultTo(true)
    table.bigInteger('endsAt').nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'targetActorId'], {
      indexName: 'mutes_actor_target_unique'
    })
    table.index(['actorId', 'createdAt'], 'mutes_actor_created')
    table.index(['targetActorId'], 'mutes_target')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => knex.schema.dropTable('mutes')
