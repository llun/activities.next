/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable('search_documents', function (table) {
    table.string('id', 64).primary()
    table.string('entityType', 32).notNullable()
    table.string('entityId').notNullable()
    table.string('actorId')
    table.string('visibility', 32)
    table.text('searchText')
    table.boolean('searchable').notNullable().defaultTo(true)
    table.timestamp('entityCreatedAt', { useTz: true })
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['entityType', 'entityId'], {
      indexName: 'search_documents_entity_unique'
    })
    table.index(
      ['entityType', 'searchable', 'entityCreatedAt', 'entityId'],
      'search_documents_query_idx'
    )
    table.index(
      ['actorId', 'entityType', 'searchable'],
      'search_documents_actor_idx'
    )
  })

  await knex.schema.createTable('search_terms', function (table) {
    table.bigIncrements('id').primary()
    table.string('documentId', 64).notNullable()
    table.string('entityType', 32).notNullable()
    table.string('term', 64).notNullable()
    table.integer('weight').notNullable().defaultTo(1)
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table
      .foreign('documentId')
      .references('id')
      .inTable('search_documents')
      .onDelete('CASCADE')
    table.unique(['documentId', 'term'], {
      indexName: 'search_terms_document_term_unique'
    })
    table.index(
      ['entityType', 'term', 'documentId', 'weight'],
      'search_terms_query_idx'
    )
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  await knex.schema.dropTable('search_terms')
  await knex.schema.dropTable('search_documents')
}
