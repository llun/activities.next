import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .createTable('accounts', function (table) {
      table.string('id').primary()
      table.string('handle').unique()
      table.string('email').unique()
      table.text('publicKey')
      table.text('privateKey')
    })
    .createTable('statuses', function (table) {
      table.string('uri').primary()
      table.string('accountId').unsigned()
      table.foreign('accountId').references('id').inTable('accounts')

      table.string('url')
      table.text('text')
      table.text('summary')

      table.string('reply')
      table.boolean('sensitive')
      table.string('visibility')
      table.string('language')

      table.string('thread')
      table.string('conversation')

      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true })
    })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('status').dropTable('accounts')
}
