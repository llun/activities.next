/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasOldHeatmaps = await knex.schema.hasTable('fitness_heatmaps')

  await knex.schema.createTable(
    'legacy_fitness_heatmap_media_cleanup',
    function (table) {
      table.string('imagePath').primary()
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('deletedAt', { useTz: true })
      table.text('error')
    }
  )

  if (hasOldHeatmaps) {
    const now = new Date()
    const oldPaths = await knex('fitness_heatmaps')
      .whereNotNull('imagePath')
      .distinct('imagePath')

    if (oldPaths.length > 0) {
      await knex('legacy_fitness_heatmap_media_cleanup').insert(
        oldPaths
          .map((row) => row.imagePath)
          .filter(Boolean)
          .map((imagePath) => ({
            imagePath,
            createdAt: now,
            deletedAt: null,
            error: null
          }))
      )
    }

    await knex.schema.dropTable('fitness_heatmaps')
  }

  await knex.schema.createTable('fitness_route_heatmaps', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable().references('id').inTable('actors')
    table.string('activityType')
    table.string('activityTypeKey').notNullable().defaultTo('')
    table.string('periodType').notNullable()
    table.string('periodKey').notNullable()
    table.string('region').notNullable().defaultTo('')
    table.timestamp('periodStart', { useTz: true })
    table.timestamp('periodEnd', { useTz: true })
    table.text('bounds')
    table.text('segments')
    table.string('status').notNullable().defaultTo('pending')
    table.text('error')
    table.integer('activityCount').notNullable().defaultTo(0)
    table.integer('pointCount').notNullable().defaultTo(0)
    table.timestamp('createdAt', { useTz: true }).notNullable()
    table.timestamp('updatedAt', { useTz: true }).notNullable()
    table.timestamp('deletedAt', { useTz: true })

    table.unique([
      'actorId',
      'activityTypeKey',
      'periodType',
      'periodKey',
      'region'
    ])
    table.index(['actorId', 'status'])
    table.index(['actorId', 'periodType'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('fitness_route_heatmaps')
  await knex.schema.dropTableIfExists('legacy_fitness_heatmap_media_cleanup')

  await knex.schema.createTable('fitness_heatmaps', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable().references('id').inTable('actors')
    table.string('activityType')
    table.string('periodType').notNullable()
    table.string('periodKey').notNullable()
    table.string('region').notNullable().defaultTo('')
    table.timestamp('periodStart', { useTz: true })
    table.timestamp('periodEnd', { useTz: true })
    table.string('imagePath')
    table.string('status').notNullable().defaultTo('pending')
    table.text('error')
    table.integer('activityCount').notNullable().defaultTo(0)
    table.timestamp('createdAt', { useTz: true }).notNullable()
    table.timestamp('updatedAt', { useTz: true }).notNullable()
    table.timestamp('deletedAt', { useTz: true })

    table.unique([
      'actorId',
      'activityType',
      'periodType',
      'periodKey',
      'region'
    ])
    table.index(['actorId', 'status'])
  })
}
