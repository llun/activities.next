exports.config = { transaction: false }

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const isPg =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql'

  // 1. Add bucketHour column to counters table
  const hasBucketHour = await knex.schema.hasColumn('counters', 'bucketHour')
  if (!hasBucketHour) {
    await knex.schema.alterTable('counters', (table) => {
      table.timestamp('bucketHour', { useTz: true }).nullable().defaultTo(null)
      table.index(['bucketHour'], 'counters_bucket_hour_index')
    })
  }

  const currentTime = new Date()

  // 2. Seed global service stat counters
  console.log('Seeding global service stat counters...')

  const [accountsResult, actorsResult, statusesResult] = await Promise.all([
    knex('accounts').count('* as count').first(),
    knex('actors').whereNotNull('accountId').count('* as count').first(),
    knex('statuses').count('* as count').first()
  ])

  const serviceTotals = [
    {
      id: 'servicestat:total-accounts',
      value: parseInt(String(accountsResult?.count ?? '0'), 10)
    },
    {
      id: 'servicestat:total-actors',
      value: parseInt(String(actorsResult?.count ?? '0'), 10)
    },
    {
      id: 'servicestat:total-statuses',
      value: parseInt(String(statusesResult?.count ?? '0'), 10)
    }
  ]

  for (const counter of serviceTotals) {
    await knex('counters')
      .insert({
        id: counter.id,
        value: counter.value,
        bucketHour: null,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict('id')
      .merge({ value: counter.value, updatedAt: currentTime })
  }

  console.log(
    `  Seeded: accounts=${serviceTotals[0].value}, actors=${serviceTotals[1].value}, statuses=${serviceTotals[2].value}`
  )

  // 3. Backfill hourly buckets from historical data
  console.log('Backfilling hourly bucket counters...')

  const hourExpr = isPg
    ? `to_char(date_trunc('hour', "createdAt"), 'YYYYMMDDHH24')`
    : `strftime('%Y%m%d%H', createdAt)`

  const hourTruncExpr = isPg
    ? `date_trunc('hour', "createdAt")`
    : `strftime('%Y-%m-%dT%H:00:00.000Z', createdAt)`

  // Helper to insert bucket rows
  const insertBuckets = async (counterType, rows) => {
    for (const row of rows) {
      const hour = row.hour
      if (!hour) continue
      const bucketId = `bucket:${counterType}:${hour}`
      const value = Math.max(0, parseInt(String(row.value ?? '0'), 10))
      const bucketHour = new Date(row.bucketHour)
      if (isNaN(bucketHour.getTime())) continue

      await knex('counters')
        .insert({
          id: bucketId,
          value,
          bucketHour,
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .onConflict('id')
        .merge({ value, bucketHour, updatedAt: currentTime })
    }
  }

  // accounts buckets
  const accountBuckets = await knex('accounts')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as value')
    )
    .groupByRaw(hourExpr)
  await insertBuckets('accounts', accountBuckets)
  console.log(`  accounts: ${accountBuckets.length} buckets`)

  // actors buckets
  const actorBuckets = await knex('actors')
    .whereNotNull('accountId')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as value')
    )
    .groupByRaw(hourExpr)
  await insertBuckets('actors', actorBuckets)
  console.log(`  actors: ${actorBuckets.length} buckets`)

  // statuses buckets
  const statusBuckets = await knex('statuses')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as value')
    )
    .groupByRaw(hourExpr)
  await insertBuckets('statuses', statusBuckets)
  console.log(`  statuses: ${statusBuckets.length} buckets`)

  // media-files and media-bytes buckets
  const mediaBuckets = await knex('medias')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as files'),
      knex.raw(
        'coalesce(sum(cast(coalesce("originalBytes",0) as bigint) + cast(coalesce("thumbnailBytes",0) as bigint)), 0) as bytes'
      )
    )
    .groupByRaw(hourExpr)

  const mediaFileRows = mediaBuckets.map((r) => ({
    hour: r.hour,
    bucketHour: r.bucketHour,
    value: r.files
  }))
  const mediaByteRows = mediaBuckets.map((r) => ({
    hour: r.hour,
    bucketHour: r.bucketHour,
    value: r.bytes
  }))
  await insertBuckets('media-files', mediaFileRows)
  await insertBuckets('media-bytes', mediaByteRows)
  console.log(`  media: ${mediaBuckets.length} buckets`)

  // fitness-files and fitness-bytes buckets
  const fitnessBuckets = await knex('fitness_files')
    .whereNull('deletedAt')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as files'),
      knex.raw('coalesce(sum(cast(coalesce("bytes",0) as bigint)), 0) as bytes')
    )
    .groupByRaw(hourExpr)

  const fitnessFileRows = fitnessBuckets.map((r) => ({
    hour: r.hour,
    bucketHour: r.bucketHour,
    value: r.files
  }))
  const fitnessByteRows = fitnessBuckets.map((r) => ({
    hour: r.hour,
    bucketHour: r.bucketHour,
    value: r.bytes
  }))
  await insertBuckets('fitness-files', fitnessFileRows)
  await insertBuckets('fitness-bytes', fitnessByteRows)
  console.log(`  fitness: ${fitnessBuckets.length} buckets`)

  console.log('Done backfilling bucket counters.')
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Remove all bucket and servicestat counter rows
  await knex('counters')
    .where('id', 'like', 'bucket:%')
    .orWhere('id', 'like', 'servicestat:%')
    .delete()

  // Drop bucketHour column and its index
  const hasBucketHour = await knex.schema.hasColumn('counters', 'bucketHour')
  if (hasBucketHour) {
    await knex.schema.alterTable('counters', (table) => {
      table.dropIndex(['bucketHour'], 'counters_bucket_hour_index')
      table.dropColumn('bucketHour')
    })
  }
}
