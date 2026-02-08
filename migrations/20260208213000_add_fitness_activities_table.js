/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('fitness_activities', (table) => {
    table.text('id').primary()
    table.text('actorId').notNullable().references('id').inTable('actors')
    table.bigInteger('stravaActivityId').notNullable()
    table.text('statusId').references('id').inTable('statuses')

    // Activity basics
    table.text('name').notNullable()
    table.text('type').notNullable() // Run, Ride, Swim, etc.
    table.text('sportType')
    table.timestamp('startDate').notNullable()
    table.text('timezone')

    // Metrics
    table.float('distance') // meters
    table.integer('movingTime') // seconds
    table.integer('elapsedTime') // seconds
    table.float('totalElevationGain') // meters
    table.float('averageSpeed') // m/s
    table.float('maxSpeed')
    table.float('averageHeartrate')
    table.float('maxHeartrate')
    table.float('averageCadence')
    table.float('averageWatts')
    table.float('kilojoules')
    table.float('calories')

    // Location
    table.jsonb('startLatlng') // [lat, lng]
    table.jsonb('endLatlng')
    table.text('summaryPolyline')

    // Map image stored via attachments
    table.text('mapAttachmentId').references('id').inTable('attachments')

    // Full response cache
    table.jsonb('rawData')

    // Timestamps
    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())

    // Unique constraint
    table.unique(['actorId', 'stravaActivityId'])

    // Indexes for common queries
    table.index(['actorId', 'startDate'])
    table.index(['statusId'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('fitness_activities')
}
