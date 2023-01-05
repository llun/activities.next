import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('actors', function (table) {
    table.renameColumn('preferredUsername', 'username')
    table.string('domain')
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('actors', function (table) {
    table.renameColumn('username', 'preferredUsername')
    table.dropColumn('domain')
  })
}
