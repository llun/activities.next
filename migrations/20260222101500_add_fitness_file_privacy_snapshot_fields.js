/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.double('privacyHomeLatitude')
    table.double('privacyHomeLongitude')
    table.integer('privacyHideRadiusMeters')
  })

  await knex('fitness_files').update({
    privacyHomeLatitude: knex('fitness_settings')
      .select('privacyHomeLatitude')
      .whereRaw('fitness_settings.actorId = fitness_files.actorId')
      .where('serviceType', 'general')
      .limit(1),
    privacyHomeLongitude: knex('fitness_settings')
      .select('privacyHomeLongitude')
      .whereRaw('fitness_settings.actorId = fitness_files.actorId')
      .where('serviceType', 'general')
      .limit(1),
    privacyHideRadiusMeters: knex('fitness_settings')
      .select('privacyHideRadiusMeters')
      .whereRaw('fitness_settings.actorId = fitness_files.actorId')
      .where('serviceType', 'general')
      .limit(1)
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.dropColumn('privacyHomeLatitude')
    table.dropColumn('privacyHomeLongitude')
    table.dropColumn('privacyHideRadiusMeters')
  })
}
