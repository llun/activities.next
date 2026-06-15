/**
 * Stores instance-wide announcements (Mastodon's "announcements") plus the
 * per-actor read state and emoji reactions. Backs the REST endpoints
 * (GET /api/v1/announcements, POST /api/v1/announcements/:id/dismiss, and
 * PUT/DELETE /api/v1/announcements/:id/reactions/:name) and the admin endpoints
 * that create, update, publish, and delete announcements.
 *
 * `text` is the raw announcement source; the HTML `content` is rendered at
 * serialization time. `published`/`publishedAt` gate visibility to actors, and
 * `allDay`/`startsAt`/`endsAt` describe an optional active window. The
 * `announcement_reads` composite key keeps one read row per (announcement,
 * actor) so dismissals are idempotent, and `announcement_reactions` keys on
 * (announcement, actor, name) so each actor reacts at most once per emoji.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('announcements', (table) => {
    table.string('id').primary()
    table.text('text').notNullable() // raw text; HTML rendered at serialization
    table.boolean('published').notNullable().defaultTo(false)
    table.boolean('allDay').notNullable().defaultTo(false)
    table.timestamp('startsAt').nullable()
    table.timestamp('endsAt').nullable()
    table.timestamp('publishedAt').nullable()
    table.timestamp('createdAt').notNullable()
    table.timestamp('updatedAt').notNullable()
  })
  await knex.schema.createTable('announcement_reads', (table) => {
    table.string('announcementId').notNullable()
    table.string('actorId').notNullable()
    table.timestamp('createdAt').notNullable()
    table.primary(['announcementId', 'actorId'])
  })
  await knex.schema.createTable('announcement_reactions', (table) => {
    table.string('announcementId').notNullable()
    table.string('actorId').notNullable()
    table.string('name').notNullable()
    table.timestamp('createdAt').notNullable()
    table.primary(['announcementId', 'actorId', 'name'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('announcement_reactions')
  await knex.schema.dropTableIfExists('announcement_reads')
  await knex.schema.dropTableIfExists('announcements')
}
