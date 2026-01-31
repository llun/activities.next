exports.up = function (knex) {
  return knex.schema.createTable('temporary_statuses', function (table) {
    table.string('id').primary()
    table.jsonb('data').notNullable()
    table.bigInteger('created_at').notNullable()
    table.bigInteger('expires_at').notNullable()

    table.index('expires_at')
  })
}

exports.down = function (knex) {
  return knex.schema.dropTable('temporary_statuses')
}
