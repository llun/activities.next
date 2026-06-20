/**
 * Collections: public, shareable, curated sets of accounts (Mastodon 4.6) plus
 * an activities.next extension that exposes each collection as a shareable feed.
 *
 * Three tables:
 *  - `collections`         one row per collection (owner + metadata + visibility)
 *  - `collection_members`  membership with a per-member public-consent state
 *  - `collection_timeline` the index-only materialized fan-out feed
 *
 * Unlike `lists`, the feed is NOT stored in the shared `timelines` table. It uses
 * a dedicated table with compact `bigint` surrogate keys (`collectionSeq`,
 * `memberSeq`) instead of the `varchar(255)` actor/list references `timelines`
 * carries, because a public collection can fan a hot author's posts into many
 * collections and this table is the high-row-count one. `seq` columns are
 * autoincrement bigints (always < 2^53, so exact in both PostgreSQL and SQLite —
 * no JS BigInt precision loss); the external `id` stays a random UUID string for
 * the API / ActivityPub identifier, matching `lists`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('collections', (table) => {
    table.bigIncrements('seq').primary()
    table.string('id').notNullable().unique()
    table.string('ownerActorId').notNullable()
    table.string('title').notNullable()
    table.text('description')
    // Single hashtag aiding discovery (Mastodon "topic"), nullable.
    table.string('topic')
    table.string('language', 10)
    // 'public' | 'unlisted' | 'private'
    table.string('visibility', 16).notNullable().defaultTo('public')
    // activities.next extension: expose the collection as a shareable feed.
    table.boolean('publicFeed').notNullable().defaultTo(true)
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['ownerActorId', 'createdAt'], 'collections_owner_created')
  })

  await knex.schema.createTable('collection_members', (table) => {
    table.bigIncrements('seq').primary()
    table.string('id').notNullable().unique()
    table.bigInteger('collectionSeq').notNullable()
    table.string('targetActorId').notNullable()
    // 'pending' | 'approved' | 'revoked' — gates PUBLIC exposure only. A member
    // is always in the owner's private feed regardless of this state.
    table.string('featureState', 16).notNullable().defaultTo('pending')
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['collectionSeq', 'targetActorId'], {
      indexName: 'collection_members_collection_target_unique'
    })
    // Inverse lookup: which collections is an account in (`in_collections`).
    table.index(['targetActorId'], 'collection_members_target')
  })

  await knex.schema.createTable('collection_timeline', (table) => {
    table.bigIncrements('id').primary()
    table.bigInteger('collectionSeq').notNullable()
    // References collection_members.seq: yields both the author (targetActorId)
    // and the public-eligibility (featureState) through a single join, replacing
    // a varchar author column and the separate approved-lookup at once.
    table.bigInteger('memberSeq').notNullable()
    table.string('statusId').notNullable()
    // Status createdAt in epoch milliseconds (< 2^53). Feed ordering key.
    table.bigInteger('sortKey').notNullable()

    table.unique(['collectionSeq', 'statusId'], {
      indexName: 'collection_timeline_collection_status_unique'
    })
    table.index(['collectionSeq', 'sortKey'], 'collection_timeline_read')
    // Member-scoped purge on remove/revoke cleanup.
    table.index(['memberSeq'], 'collection_timeline_member')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('collection_timeline')
  await knex.schema.dropTableIfExists('collection_members')
  await knex.schema.dropTableIfExists('collections')
}
