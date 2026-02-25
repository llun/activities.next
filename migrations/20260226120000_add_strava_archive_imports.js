/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('strava_archive_imports', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('archiveId').notNullable().unique()
    table.string('archiveFitnessFileId').notNullable()
    table.string('batchId').notNullable()
    table.string('visibility').notNullable()
    table.string('status').notNullable()
    table.integer('nextActivityIndex').notNullable().defaultTo(0)
    table.text('pendingMediaActivities')
    table.integer('mediaAttachmentRetry').notNullable().defaultTo(0)
    table.integer('totalActivitiesCount')
    table.integer('completedActivitiesCount').notNullable().defaultTo(0)
    table.integer('failedActivitiesCount').notNullable().defaultTo(0)
    table.text('firstFailureMessage')
    table.text('lastError')
    table.timestamp('resolvedAt', { useTz: true }).nullable()
    table
      .timestamp('createdAt', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())
    table
      .timestamp('updatedAt', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now())

    table.index(
      ['actorId', 'status'],
      'strava_archive_imports_actor_status_idx'
    )
    table.index(['batchId'], 'strava_archive_imports_batch_id_idx')
  })

  const client = knex.client.config.client
  const supportsPartialUniqueIndex = [
    'pg',
    'postgres',
    'postgresql',
    'sqlite3',
    'better-sqlite3'
  ].includes(client)

  if (supportsPartialUniqueIndex) {
    await knex.schema.raw(
      'CREATE UNIQUE INDEX strava_archive_imports_actor_active_idx ON strava_archive_imports("actorId") WHERE "resolvedAt" IS NULL'
    )
  } else {
    // Fallback for database engines without partial unique indexes.
    await knex.schema.alterTable('strava_archive_imports', function (table) {
      table.index(
        ['actorId', 'resolvedAt'],
        'strava_archive_imports_actor_resolved_idx'
      )
    })
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const client = knex.client.config.client
  const supportsPartialUniqueIndex = [
    'pg',
    'postgres',
    'postgresql',
    'sqlite3',
    'better-sqlite3'
  ].includes(client)

  if (supportsPartialUniqueIndex) {
    await knex.schema.raw(
      'DROP INDEX IF EXISTS strava_archive_imports_actor_active_idx'
    )
  } else {
    await knex.schema.alterTable('strava_archive_imports', function (table) {
      table.dropIndex(
        ['actorId', 'resolvedAt'],
        'strava_archive_imports_actor_resolved_idx'
      )
    })
  }

  await knex.schema.dropTable('strava_archive_imports')
}
