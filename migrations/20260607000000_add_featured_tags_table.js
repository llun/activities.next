/**
 * Stores the hashtags an actor features on their profile (Mastodon's
 * "featured tags"). A featured tag is scoped to (actor, normalized name): the
 * actor pins a hashtag so clients and remote servers can surface it. Backs the
 * REST endpoints (GET/POST /api/v1/featured_tags, DELETE /featured_tags/:id,
 * GET /featured_tags/suggestions, GET /accounts/:id/featured_tags) and the AP
 * featured-tags OrderedCollection.
 *
 * `name` keeps the original display casing to echo back to clients;
 * `nameNormalized` is the lower-cased bare name used for the uniqueness
 * constraint and for joining against the existing `tags` table when deriving
 * statuses_count / last_status_at at read time.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('featured_tags', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('name').notNullable()
    table.string('nameNormalized').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['actorId', 'nameNormalized'], {
      indexName: 'featured_tags_actor_name_unique'
    })
    // No separate index on actorId: it is the leftmost column of the composite
    // unique index above, which already serves actorId-prefixed lookups.
    table.index(['nameNormalized'], 'featured_tags_name')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTableIfExists('featured_tags')
