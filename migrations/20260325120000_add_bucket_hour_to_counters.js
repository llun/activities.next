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
    })
  }

  // 2. Create index independently so reruns can repair a partial first run
  try {
    await knex.schema.alterTable('counters', (table) => {
      table.index(['bucketHour'], 'counters_bucket_hour_index')
    })
  } catch (err) {
    const msg = String(err?.message ?? '').toLowerCase()
    if (!msg.includes('already exists') && !msg.includes('duplicate')) {
      throw err
    }
  }

  const currentTime = new Date()

  // 2. Seed global service stat counters
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

  // 3. Backfill hourly buckets from historical data
  // Use UTC explicitly so bucket ids match counterBucket.ts (which uses UTC)
  const hourExpr = isPg
    ? `to_char(date_trunc('hour', "createdAt" AT TIME ZONE 'UTC'), 'YYYYMMDDHH24')`
    : `strftime('%Y%m%d%H', createdAt)`

  const hourTruncExpr = isPg
    ? `date_trunc('hour', "createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
    : `strftime('%Y-%m-%dT%H:00:00.000Z', createdAt)`

  const groupByExpr = `${hourExpr}, ${hourTruncExpr}`

  // Helper to insert bucket rows in chunks
  const insertBuckets = async (counterType, rows) => {
    const CHUNK_SIZE = 100
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      const inserts = []
      for (const row of chunk) {
        const hour = row.hour
        if (!hour) continue
        const bucketId = `bucket:${counterType}:${hour}`
        const value = Math.max(0, parseInt(String(row.value ?? '0'), 10))
        const bucketHour = new Date(row.bucketHour)
        if (isNaN(bucketHour.getTime())) continue
        inserts.push({
          id: bucketId,
          value,
          bucketHour,
          createdAt: currentTime,
          updatedAt: currentTime
        })
      }
      if (inserts.length > 0) {
        await knex('counters')
          .insert(inserts)
          .onConflict('id')
          .merge(['value', 'bucketHour', 'updatedAt'])
      }
    }
  }

  // accounts buckets
  const accountBuckets = await knex('accounts')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as value')
    )
    .groupByRaw(groupByExpr)
  await insertBuckets('accounts', accountBuckets)

  // actors buckets
  const actorBuckets = await knex('actors')
    .whereNotNull('accountId')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as value')
    )
    .groupByRaw(groupByExpr)
  await insertBuckets('actors', actorBuckets)

  // statuses buckets
  const statusBuckets = await knex('statuses')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as value')
    )
    .groupByRaw(groupByExpr)
  await insertBuckets('statuses', statusBuckets)

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
    .groupByRaw(groupByExpr)

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

  // fitness-files and fitness-bytes buckets — include all rows (even soft-deleted)
  // because buckets are increment-only and track creation activity per hour.
  // Deleted files were still created at those hours.
  const fitnessBuckets = await knex('fitness_files')
    .select(
      knex.raw(`${hourExpr} as hour`),
      knex.raw(`${hourTruncExpr} as "bucketHour"`),
      knex.raw('count(*) as files'),
      knex.raw('coalesce(sum(cast(coalesce("bytes",0) as bigint)), 0) as bytes')
    )
    .groupByRaw(groupByExpr)

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

  // Drop index independently so partial states don't block rollback
  try {
    await knex.schema.alterTable('counters', (table) => {
      table.dropIndex(['bucketHour'], 'counters_bucket_hour_index')
    })
  } catch (err) {
    const msg = String(err?.message ?? '').toLowerCase()
    if (!msg.includes('does not exist') && !msg.includes('no such index')) {
      throw err
    }
  }

  // Drop bucketHour column
  const hasBucketHour = await knex.schema.hasColumn('counters', 'bucketHour')
  if (hasBucketHour) {
    await knex.schema.alterTable('counters', (table) => {
      table.dropColumn('bucketHour')
    })
  }
}
