import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('attachments', function (table) {
    table.string('id').primary()
    table.string('statusId').index('statusIndex')
    table.string('url')
    table.string('mediaType')
    table.string('type')
    table.integer('width')
    table.integer('height')
    table.text('name')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('attachments')
}
