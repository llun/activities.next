const usesMysqlTextTypes = (knex) => {
  const client = String(knex.client.config.client)
  return client.includes('mysql') || client.includes('maria')
}

const addLargeTextColumn = (knex, table, columnName) => {
  if (usesMysqlTextTypes(knex)) {
    table.specificType(columnName, 'mediumtext')
    return
  }

  table.text(columnName)
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
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

      const cleanupRows = oldPaths
        .filter((row) => row.actorId && row.imagePath)
        .map((row) => ({
          actorId: row.actorId,
          imagePath: row.imagePath,
          createdAt: now,
          deletedAt: null,
          error: null
        }))

      if (cleanupRows.length > 0) {
        await trx('legacy_fitness_heatmap_media_cleanup')
          .insert(cleanupRows)
          .onConflict(['actorId', 'imagePath'])
          .ignore()
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
        addLargeTextColumn(trx, table, 'bounds')
        addLargeTextColumn(trx, table, 'segments')
        table.string('status').notNullable().defaultTo('pending')
        table.text('error')
        table.integer('activityCount').notNullable().defaultTo(0)
        table.integer('pointCount').notNullable().defaultTo(0)
        table.integer('cursorOffset').notNullable().defaultTo(0)
        table.boolean('isPartial').notNullable().defaultTo(false)
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
export const down = async function (knex) {
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
