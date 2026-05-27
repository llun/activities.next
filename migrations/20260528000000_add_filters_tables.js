/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable('filters', (table) => {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('title').notNullable()
    table.text('context').notNullable()
    table.string('filterAction').notNullable().defaultTo('warn')
    table.bigInteger('expiresAt').nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['actorId', 'createdAt'], 'filters_actor_created')
  })

  await knex.schema.createTable('filter_keywords', (table) => {
    table.string('id').primary()
    table.string('filterId').notNullable()
    table.text('keyword').notNullable()
    table.boolean('wholeWord').notNullable().defaultTo(false)
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['filterId', 'keyword'], {
      indexName: 'filter_keywords_filter_keyword_unique'
    })
    table.index(['filterId'], 'filter_keywords_filter_id')
  })

  await knex.schema.createTable('filter_statuses', (table) => {
    table.string('id').primary()
    table.string('filterId').notNullable()
    table.string('statusId').notNullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['filterId', 'statusId'], {
      indexName: 'filter_statuses_filter_status_unique'
    })
    table.index(['filterId'], 'filter_statuses_filter_id')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('filter_statuses')
  await knex.schema.dropTableIfExists('filter_keywords')
  await knex.schema.dropTableIfExists('filters')
}
