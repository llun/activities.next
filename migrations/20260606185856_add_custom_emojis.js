/**
 * Stores instance-scoped custom emoji (Mastodon's CustomEmoji). Each row is a
 * `:shortcode:` mapped to an uploaded image, served unauthenticated from
 * `GET /api/v1/custom_emojis` and federated as ActivityPub `Emoji` tags on any
 * status whose text contains the shortcode.
 *
 * Mirrors the Mastodon CustomEmoji entity
 * (https://docs.joinmastodon.org/entities/CustomEmoji/): `shortcode`, `url`,
 * `static_url`, `visible_in_picker`, `category`, plus a `disabled` flag used by
 * the admin surface (Mastodon's `listed` scope is `disabled = false AND
 * visible_in_picker = true`).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) =>
  knex.schema.createTable('customEmojis', (table) => {
    table.string('id').primary()
    // Shortcode without surrounding colons, validated `^[a-zA-Z0-9_]+$`.
    table.string('shortcode').notNullable().unique()
    table.text('url').notNullable()
    table.text('staticUrl').notNullable()
    table.string('category').nullable()
    table.boolean('visibleInPicker').notNullable().defaultTo(true)
    table.boolean('disabled').notNullable().defaultTo(false)
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('customEmojis')
