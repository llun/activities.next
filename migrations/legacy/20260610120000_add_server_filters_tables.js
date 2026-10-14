/**
 * Server (instance-wide) keyword filters. Mirrors the per-actor `filters` /
 * `filter_keywords` tables but without an `actorId` — these rules are authored
 * by admins and apply to everyone on the instance. There is intentionally no
 * `server_filter_statuses` table: server filters are keyword-only.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.createTable('server_filters', (table) => {
    table.string('id').primary()
    table.string('title').notNullable()
    table.text('context').notNullable()
    table.string('filterAction').notNullable().defaultTo('warn')
    table.bigInteger('expiresAt').nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    // getActiveServerFilters filters on expiresAt on every timeline/notification
    // request (a hot path), so index it alongside the ordering column.
    table.index(['expiresAt'], 'server_filters_expires_at')
    table.index(['createdAt'], 'server_filters_created')
  })

  await knex.schema.createTable('server_filter_keywords', (table) => {
    table.string('id').primary()
    table.string('filterId').notNullable()
    table.text('keyword').notNullable()
    table.boolean('wholeWord').notNullable().defaultTo(false)
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['filterId', 'keyword'], {
      indexName: 'server_filter_keywords_filter_keyword_unique'
    })
    table.index(['filterId'], 'server_filter_keywords_filter_id')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTableIfExists('server_filter_keywords')
  await knex.schema.dropTableIfExists('server_filters')
}
