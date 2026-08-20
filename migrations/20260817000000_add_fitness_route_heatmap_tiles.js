// Storage for the zoom-tiled route-heatmap pyramid.
//
// `fitness_route_heatmaps` keeps the whole of a heatmap as one JSON blob of
// route segments, fit to a single global vertex budget. That budget is why
// precision falls off with coverage: a city-sized heatmap fits it at the 1 m
// simplification floor and looks sharp, while a world-spanning one is coarsened
// to hundreds of meters and cuts across roads. Zooming in never reveals more,
// because the whole map is simplified once and reused at every zoom.
//
// These three tables hold the replacement, where precision is fixed per screen
// pixel at every zoom instead of shared out across the whole map:
//
// - `fitness_file_routes` caches each activity's simplified polyline. Geometry
//   otherwise exists only inside the original FIT/GPX/TCX in object storage
//   (`fitness_files` has no route columns), so every rebuild re-downloads and
//   re-parses every file.
// - `fitness_route_heatmap_pyramids` holds one build-state row per actor: the
//   monotonic build version, the resume cursor and the progress counters.
// - `fitness_route_heatmap_tiles` holds the geometry, one row per
//   (actor, z, x, y), so a viewport reads only the tiles it draws and a build
//   flushes bounded batches instead of rewriting one ever-growing blob.
//
// Nothing READS these tables yet. The generation job writes them, but the
// serving API and the client's zoom-aware fetching land in later changes, so
// `fitness_route_heatmaps` is untouched and keeps serving every heatmap.

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
  const hasRouteTable = await knex.schema.hasTable('fitness_file_routes')
  if (!hasRouteTable) {
    await knex.schema.createTable('fitness_file_routes', function (table) {
      table
        .string('fitnessFileId')
        .primary()
        .references('id')
        .inTable('fitness_files')
        .onDelete('CASCADE')
      // Denormalized from the owning file so the actor-scoped reads, the bbox
      // index below and the whole-actor cleanup never have to join.
      table
        .string('actorId')
        .notNullable()
        .references('id')
        .inTable('actors')
        .onDelete('CASCADE')
      // JSON array of [lat, lng] pairs, already point-capped and simplified at
      // the configured floor tolerance. A long ride runs to a few thousand
      // pairs, so this can outgrow MySQL's 64 KiB `text` exactly as the route
      // cache's payload columns did.
      addLargeTextColumn(knex, table, 'points')
      table.integer('pointCount').notNullable().defaultTo(0)
      // All four are null when the activity carries no GPS at all (a treadmill
      // run). The row is still written, as a negative cache: without it every
      // rebuild would re-download and re-parse those files only to rediscover
      // they have no route to contribute.
      table.double('minLat').nullable()
      table.double('maxLat').nullable()
      table.double('minLng').nullable()
      table.double('maxLng').nullable()
      // Bumped when the cached representation itself changes shape (a different
      // simplification floor, a different encoding), so a stale row is
      // re-derived from the source file instead of trusted.
      table.integer('sourceVersion').notNullable().defaultTo(1)
      table.timestamp('createdAt', { useTz: true }).notNullable()
      table.timestamp('updatedAt', { useTz: true }).notNullable()

      table.index(['actorId'], 'fitness_file_routes_actor_id_idx')
      table.index(
        ['actorId', 'minLat', 'maxLat'],
        'fitness_file_routes_actor_lat_idx'
      )
    })
  }

  const hasPyramidTable = await knex.schema.hasTable(
    'fitness_route_heatmap_pyramids'
  )
  if (!hasPyramidTable) {
    await knex.schema.createTable(
      'fitness_route_heatmap_pyramids',
      function (table) {
        table.string('id').primary()
        table
          .string('actorId')
          .notNullable()
          .references('id')
          .inTable('actors')
          .onDelete('CASCADE')
        table.string('status').notNullable().defaultTo('idle')
        table.text('error').nullable()
        // Monotonic TILE GENERATION counter. Every tile records the version
        // that wrote it, so a resumed pass adds to its own tiles while a fresh
        // build replaces them, and completion sweeps whatever an older version
        // left behind — which is how activities deleted since the last build
        // disappear without any per-activity bookkeeping.
        table.integer('version').notNullable().defaultTo(0)
        // Monotonic OWNERSHIP counter, bumped by every successful claim. This
        // is deliberately not `version`: a resumed build must keep its version
        // (or completion would sweep the very tiles the interrupted pass
        // already wrote), so version cannot also identify the owner. Guarding
        // the claim and every subsequent write on this instead is what stops
        // two workers resuming the same abandoned build, and what fences a
        // presumed-dead pass that wakes up after another worker took over.
        table.integer('claimSeq').notNullable().defaultTo(0)
        table.integer('totalCount').notNullable().defaultTo(0)
        table.integer('scannedCount').notNullable().defaultTo(0)
        table.integer('activityCount').notNullable().defaultTo(0)
        table.integer('tileCount').notNullable().defaultTo(0)
        table.integer('pointCount').notNullable().defaultTo(0)
        // Keyset resume cursor: the (createdAt, id) of the last activity folded
        // into the pyramid. An integer offset would double-count or skip an
        // activity whenever an upload or delete shifts the window between
        // passes, and a double-counted activity is a permanently wrong heat
        // value rather than a missing row.
        table.timestamp('cursorCreatedAt', { useTz: true }).nullable()
        table.string('cursorId').nullable()
        table.timestamp('completedAt', { useTz: true }).nullable()
        table.timestamp('createdAt', { useTz: true }).notNullable()
        table.timestamp('updatedAt', { useTz: true }).notNullable()

        table.unique(['actorId'], {
          indexName: 'fitness_route_heatmap_pyramids_actor_unique'
        })
      }
    )
  }

  const hasTileTable = await knex.schema.hasTable('fitness_route_heatmap_tiles')
  if (!hasTileTable) {
    await knex.schema.createTable(
      'fitness_route_heatmap_tiles',
      function (table) {
        table
          .string('actorId')
          .notNullable()
          .references('id')
          .inTable('actors')
          .onDelete('CASCADE')
        // "z:x:y". Stored beside the numeric columns because the two access
        // patterns want different shapes: a build addresses tiles by key (it
        // accumulates a keyed map of pending deltas and flushes it), while a
        // viewport reads an x/y range at one zoom.
        table.string('tileKey').notNullable()
        table.integer('z').notNullable()
        table.integer('x').notNullable()
        table.integer('y').notNullable()
        table.integer('version').notNullable().defaultTo(0)
        // Encoded tile geometry. A dense city tile at the finest stored zoom
        // holds the whole road network around it, so this is the other column
        // that needs MySQL's mediumtext.
        addLargeTextColumn(knex, table, 'segments')
        table.integer('pointCount').notNullable().defaultTo(0)
        table.timestamp('createdAt', { useTz: true }).notNullable()
        table.timestamp('updatedAt', { useTz: true }).notNullable()

        table.primary(['actorId', 'tileKey'])
        table.index(
          ['actorId', 'z', 'x', 'y'],
          'fitness_route_heatmap_tiles_actor_z_x_y_idx'
        )
        table.index(
          ['actorId', 'version'],
          'fitness_route_heatmap_tiles_actor_version_idx'
        )
      }
    )
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.dropTableIfExists('fitness_route_heatmap_tiles')
  await knex.schema.dropTableIfExists('fitness_route_heatmap_pyramids')
  await knex.schema.dropTableIfExists('fitness_file_routes')
}
