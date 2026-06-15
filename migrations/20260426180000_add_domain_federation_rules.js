/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function (knex) {
  return knex.schema.createTable('domain_federation_rules', function (table) {
    table.string('id').primary()
    table.string('domain').notNullable()
    table.string('type').notNullable()
    table.string('severity').nullable()
    table.boolean('rejectMedia').notNullable().defaultTo(false)
    table.boolean('rejectReports').notNullable().defaultTo(false)
    table.text('privateComment').nullable()
    table.text('publicComment').nullable()
    table.boolean('obfuscate').notNullable().defaultTo(false)
    table.string('source').nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.unique(['type', 'domain'], {
      indexName: 'domain_federation_rules_type_domain_unique'
    })
    table.index(['type', 'createdAt'], 'domain_federation_rules_type_idx')
    table.index(['source'], 'domain_federation_rules_source_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function (knex) {
  return knex.schema.dropTable('domain_federation_rules')
}
