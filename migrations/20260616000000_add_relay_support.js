/**
 * Relay support schema.
 *
 * `relays` holds one row per ActivityPub relay subscription. It is kept
 * deliberately separate from `follows` so relay edges never pollute
 * follower/following counts or lists. `inboxUrl` is the relay inbox the admin
 * subscribes to (where we POST our Follow and forward local public posts).
 * `actorId` is the relay's actor id, learned from the relay's Accept, and is
 * what we match an inbound relay-forwarded activity's HTTP signer against.
 * `state` mirrors FollowStatus-like semantics (idle | pending | accepted |
 * rejected) but as its own column. `followActivityId` is the id of the Follow
 * activity we sent, used to match the relay's Accept back to the row.
 *
 * `federated_timeline` is the dedicated, materialized store for the "Federated"
 * (whole known network) timeline. We append one row per remote public status
 * ingested from an accepted relay; the timeline read joins it back to
 * `statuses`. It holds remote relay-sourced statuses only — local public posts
 * keep coming from the existing LOCAL_PUBLIC query.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('relays', (table) => {
    table.string('id').primary()
    table.string('inboxUrl').notNullable().unique()
    table.string('actorId').nullable()
    table.string('state').notNullable().defaultTo('idle')
    table.string('followActivityId').nullable()
    table.text('lastError').nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['actorId'], 'relays_actor_id')
    table.index(['state'], 'relays_state')
  })

  await knex.schema.createTable('federated_timeline', (table) => {
    table.string('statusId').primary()
    table.string('statusActorId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['statusActorId'], 'federated_timeline_status_actor_id')
    table
      .foreign('statusId')
      .references('id')
      .inTable('statuses')
      .onDelete('CASCADE')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('federated_timeline')
  await knex.schema.dropTableIfExists('relays')
}
