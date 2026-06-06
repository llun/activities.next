/**
 * Stores profile endorsements (Mastodon's "featured accounts"). An endorsement
 * is scoped to (author actor, target actor): the author features the target on
 * their profile. Backs the endorse/unendorse actions (POST /accounts/:id/pin,
 * /unpin), the endorsement lists (GET /accounts/:id/endorsements, GET
 * /endorsements), and the `endorsed` field of a Relationship.
 *
 * The primary key is an auto-incrementing integer so the list endpoints can
 * paginate with Mastodon-style numeric `max_id`/`min_id`/`since_id` cursors in
 * insertion order, the same way Mastodon paginates by AccountPin id.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('endorsements', (table) => {
    table.increments('id').primary()
    table.string('actorId').notNullable()
    table.string('actorHost').notNullable()
    table.string('targetActorId').notNullable()
    table.string('targetActorHost').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    // The composite unique index also serves leftmost-prefix lookups by
    // actorId, so no separate single-column index is needed.
    table.unique(['actorId', 'targetActorId'], {
      indexName: 'endorsements_actor_target_unique'
    })
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('endorsements')
