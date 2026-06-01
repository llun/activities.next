/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('followed_tags', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    // Normalized (lower-cased) tag name used for matching, plus the original
    // display name to echo back to clients.
    table.string('name').notNullable()
    table.string('nameNormalized').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'nameNormalized'], {
      indexName: 'followed_tags_actor_name_unique'
    })
    // No separate index on actorId: it is the leftmost column of the composite
    // unique index above, which already serves actorId-prefixed lookups.
    table.index(['nameNormalized'], 'followed_tags_name')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTableIfExists('followed_tags')
