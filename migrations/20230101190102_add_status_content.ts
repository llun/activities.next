import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('statuses', function (table) {
    table.text('content')
    table.dropColumn('text')
    table.dropColumn('summary')
    table.dropColumn('url')
    table.dropColumn('sensitive')
    table.dropColumn('visibility')
    table.dropColumn('language')
    table.dropColumn('thread')
    table.dropColumn('conversation')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('statuses', function (table) {
    table.dropColumn('content')
    table.text('text')
    table.text('summary')
    table.string('url')
    table.boolean('sensitive')
    table.string('visibility')
    table.string('language')
    table.string('thread')
    table.string('conversation')
  })
}
