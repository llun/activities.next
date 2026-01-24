/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema.createTable('fitness_activities', function (table) {
    table.string('id').primary()
    table.string('actorId').notNullable()
    table.string('statusId') // Link to the created status
    table.string('provider').notNullable().defaultTo('strava') // 'strava' or other future providers
    table.string('providerId').notNullable() // Activity ID from the provider
    table.string('type') // e.g., 'Run', 'Ride', 'Swim'
    table.string('name') // Activity name/title
    table.text('description') // Activity description
    table.timestamp('startDate', { useTz: true })
    table.timestamp('endDate', { useTz: true })
    
    // Metrics
    table.float('distance') // in meters
    table.integer('movingTime') // in seconds
    table.integer('elapsedTime') // in seconds
    table.float('totalElevationGain') // in meters
    table.float('averageSpeed') // in m/s
    table.float('maxSpeed') // in m/s
    table.float('averageHeartrate') // bpm
    table.float('maxHeartrate') // bpm
    table.float('averageWatts') // watts
    table.float('maxWatts') // watts
    table.float('calories') // kcal
    
    // Location data
    table.jsonb('startLatlng') // [lat, lng]
    table.jsonb('endLatlng') // [lat, lng]
    table.string('mapPolyline') // Encoded polyline for route
    table.string('mapSummaryPolyline') // Simplified polyline
    
    // Images and media
    table.jsonb('photos') // Array of photo URLs
    
    // Full raw data from provider
    table.jsonb('rawData') // Complete activity object from provider
    
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
    
    // Indexes for efficient querying
    table.index(['actorId', 'createdAt'], 'fitness_activities_actor_created')
    table.index(['statusId'], 'fitness_activities_status')
    table.index(['provider', 'providerId'], 'fitness_activities_provider')
    table.unique(['provider', 'providerId', 'actorId'], 'fitness_activities_unique')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema.dropTable('fitness_activities')
}
