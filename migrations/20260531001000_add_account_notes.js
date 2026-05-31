/**
 * Stores the private, per-relationship note Mastodon's POST
 * /accounts/:id/note endpoint sets (the `comment` param). A note is scoped to
 * (author actor, target actor); only the author can read it back via the
 * relationship's `note` field.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('account_notes', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('actorHost').notNullable()
    table.string('targetActorId').notNullable()
    table.string('targetActorHost').notNullable()
    table.text('comment').notNullable().defaultTo('')
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    // The composite unique index also serves leftmost-prefix lookups by
    // actorId, so no separate single-column index is needed.
    table.unique(['actorId', 'targetActorId'], {
      indexName: 'account_notes_actor_target_unique'
    })
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('account_notes')
