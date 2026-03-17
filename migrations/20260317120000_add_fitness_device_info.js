exports.up = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.string('deviceManufacturer')
    table.string('deviceName')
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.dropColumn('deviceManufacturer')
    table.dropColumn('deviceName')
  })
}
