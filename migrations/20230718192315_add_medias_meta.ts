import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('medias', function (table) {
    table.json('originalMetaData')
    table.json('thumbnailMetaData').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('medias', function (table) {
    table.dropColumn('originalMetaData')
    table.dropColumn('thumbnailMetaData')
  })
}
