/**
 * User-level Mastodon domain blocks (`/api/v1/domain_blocks`). One row per
 * (actor, domain); `domain` stores the normalized hostname. This is separate
 * from the admin-level instance-wide rules in `domain_federation_rules`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.createTable('actor_domain_blocks', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('domain').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'domain'], {
      indexName: 'actor_domain_blocks_actor_domain_unique'
    })
    table.index(['actorId', 'createdAt'], 'actor_domain_blocks_actor_created')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => knex.schema.dropTable('actor_domain_blocks')
