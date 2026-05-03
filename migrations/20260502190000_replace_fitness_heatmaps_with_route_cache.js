/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.transaction(async (trx) => {
    const hasOldHeatmaps = await trx.schema.hasTable('fitness_heatmaps')
    const hasLegacyCleanup = await trx.schema.hasTable(
      'legacy_fitness_heatmap_media_cleanup'
    )

    if (!hasLegacyCleanup) {
      await trx.schema.createTable(
        'legacy_fitness_heatmap_media_cleanup',
        function (table) {
          table.string('actorId').notNullable()
          table.string('imagePath').notNullable()
          table.timestamp('createdAt', { useTz: true }).notNullable()
          table.timestamp('deletedAt', { useTz: true })
          table.text('error')

          table.primary(['actorId', 'imagePath'])
        }
      )
    }

    if (hasOldHeatmaps) {
      const now = new Date()
      const oldPaths = await trx('fitness_heatmaps')
        .whereNotNull('imagePath')
        .distinct('actorId', 'imagePath')

      for (const row of oldPaths.filter(
        (item) => item.actorId && item.imagePath
      )) {
        const existing = await trx('legacy_fitness_heatmap_media_cleanup')
          .where('actorId', row.actorId)
          .where('imagePath', row.imagePath)
          .first()

        if (!existing) {
          await trx('legacy_fitness_heatmap_media_cleanup').insert({
            actorId: row.actorId,
            imagePath: row.imagePath,
            createdAt: now,
            deletedAt: null,
            error: null
          })
        }
      }

      await trx.schema.dropTable('fitness_heatmaps')
    }

    const hasRouteHeatmaps = await trx.schema.hasTable('fitness_route_heatmaps')
    if (!hasRouteHeatmaps) {
      await trx.schema.createTable('fitness_route_heatmaps', function (table) {
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
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.transaction(async (trx) => {
    await trx.schema.dropTableIfExists('fitness_route_heatmaps')
    await trx.schema.dropTableIfExists('legacy_fitness_heatmap_media_cleanup')

    const hasOldHeatmaps = await trx.schema.hasTable('fitness_heatmaps')
    if (!hasOldHeatmaps) {
      await trx.schema.createTable('fitness_heatmaps', function (table) {
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
  })
}
