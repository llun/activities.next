import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('actors', function (table) {
    table.dropUnique(['username'], 'actors_preferredUsername_unique')
    table.unique(['username', 'domain'])
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('actors', function (table) {
    table.dropUnique(['username', 'domain'])
    table.unique(['username'])
  })
}
