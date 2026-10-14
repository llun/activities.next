/**
 * Link preview cards (Mastodon PreviewCard).
 *
 * Two tables, mirroring Mastodon's own split:
 *
 * - `link_previews` caches one card per URL, keyed by `urlHash`
 *   (sha256 of the normalized URL). Cards are shared across every status that
 *   links the same page, so a popular link is fetched once per refresh window
 *   rather than once per post.
 * - `status_link_previews` maps a status to the card it displays. A status
 *   shows at most one card, so `statusId` is the primary key.
 *
 * There is intentionally no FK to `statuses` — the same choice
 * `status_quotes`, likes and recipients make, and it keeps SQLite's
 * `alterTable` limitations out of the picture.
 *
 * `fetchStatus` doubles as the negative cache: a `failed` row records that the
 * page could not be read, so an unreachable host is not re-fetched on every
 * mention. Cards are only ever linked to a status once fetching succeeded.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('link_previews', (table) => {
    table.string('urlHash', 64).primary()
    table.text('url').notNullable()
    // Mastodon's PreviewCard `type`. Only ever read as a hint today: every card
    // renders with the same link anatomy.
    table.string('type', 32).notNullable().defaultTo('link')
    table.text('title').nullable()
    table.text('description').nullable()
    table.string('siteName', 255).nullable()
    table.string('authorName', 255).nullable()
    table.text('authorUrl').nullable()
    table.text('imageUrl').nullable()
    table.integer('imageWidth').nullable()
    table.integer('imageHeight').nullable()
    table.timestamp('publishedAt', { useTz: true }).nullable()
    // pending | completed | failed
    table.string('fetchStatus', 32).notNullable().defaultTo('pending')
    // Why a fetch failed, for the negative cache and for operators.
    table.text('error').nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    // Staleness sweeps and the refresh check both read (fetchStatus, updatedAt).
    table.index(
      ['fetchStatus', 'updatedAt'],
      'link_previews_status_updated_idx'
    )
  })

  await knex.schema.createTable('status_link_previews', (table) => {
    table.string('statusId', 255).primary()
    table.string('urlHash', 64).notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    // Reverse lookup: which statuses show a given card (orphan sweeps).
    table.index(['urlHash'], 'status_link_previews_urlhash_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('status_link_previews')
  await knex.schema.dropTableIfExists('link_previews')
}
