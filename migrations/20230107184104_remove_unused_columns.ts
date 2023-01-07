import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema
    .alterTable('actors', function (table) {
      table.dropColumn('manuallyApprovesFollowers')
      table.dropColumn('discoverable')
      table.dropColumn('followerUrl')
      table.text('urls')
    })
    .dropTable('questions')
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('actors', function (table) {
    table.boolean('manuallyApprovesFollowers')
    table.boolean('discoverable')
    table.string('followerUrl')
    table.dropColumn('urls')
  })
}
