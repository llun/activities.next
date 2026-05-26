const CHUNK_SIZE = 100
const READ_CHUNK_SIZE = 1000
const ACTIVITY_COUNTER_PREFIXES = [
  'bucket:local-statuses:%',
  'bucket:logins:%',
  'unique-login:%'
]
const BACKFILL_COUNTER_PREFIX = 'backfill:instance-activity:'
const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

const toDate = (value) => {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed
    return new Date(normalized)
  }
  return new Date(value)
}

const truncateToHour = (date) =>
  new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours()
    )
  )

const formatBucketHour = (date) => {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  return `${y}${mo}${d}${h}`
}

const getUTCWeekStart = (date) => {
  const day = date.getUTCDay()
  const daysSinceMonday = (day + 6) % 7

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - daysSinceMonday
    )
  )
}

const getWeekKey = (date) =>
  String(Math.floor(getUTCWeekStart(date).getTime() / 1000))

const getLoginMarkerId = (accountId) => `unique-login:${accountId}`
const getBackfillCounterId = (counterId) =>
  `${BACKFILL_COUNTER_PREFIX}${counterId}`

const isMySQLClient = (knex) => {
  const client = String(knex.client.config.client).toLowerCase()
  return client.includes('mysql')
}

const isMariaDBClient = (knex) => {
  const client = String(knex.client.config.client).toLowerCase()
  return client.includes('maria')
}

const addBucketCounter = (counters, counterType, date, value = 1) => {
  const bucketHour = truncateToHour(date)
  const id = `bucket:${counterType}:${formatBucketHour(bucketHour)}`
  const existing = counters.get(id)

  counters.set(id, {
    id,
    value: (existing?.value ?? 0) + value,
    bucketHour
  })
}

const getExistingActivityCounterCutoff = async (knex, currentTime) => {
  const row = await knex('counters')
    .where((builder) => {
      for (const prefix of ACTIVITY_COUNTER_PREFIXES) {
        builder.orWhere('id', 'like', prefix)
      }
    })
    .min('createdAt as createdAt')
    .first()

  if (!row?.createdAt) return currentTime

  const createdAt = toDate(row.createdAt)
  return Number.isNaN(createdAt.getTime()) ? currentTime : createdAt
}

const MYSQL_COUNTER_ALIAS = 'new_values'
const COUNTER_COLUMNS = ['id', 'value', 'bucketHour', 'createdAt', 'updatedAt']

const buildMySQLCounterInsertQuery = (
  knex,
  rows,
  updateSql,
  updateBindings
) => {
  const rowPlaceholders = rows.map(() => '(?, ?, ?, ?, ?)').join(', ')
  const rowBindings = rows.flatMap((row) =>
    COUNTER_COLUMNS.map((column) => row[column])
  )

  return knex.raw(
    `insert into ?? (??, ??, ??, ??, ??) values ${rowPlaceholders} as ?? on duplicate key update ${updateSql}`,
    [
      'counters',
      ...COUNTER_COLUMNS,
      ...rowBindings,
      MYSQL_COUNTER_ALIAS,
      ...updateBindings
    ]
  )
}

const buildMySQLBucketCounterUpsertQuery = (knex, rows) =>
  buildMySQLCounterInsertQuery(
    knex,
    rows,
    '?? = ??.?? + ??.??, ?? = ??.??, ?? = ??.??',
    [
      'value',
      'counters',
      'value',
      MYSQL_COUNTER_ALIAS,
      'value',
      'bucketHour',
      MYSQL_COUNTER_ALIAS,
      'bucketHour',
      'updatedAt',
      MYSQL_COUNTER_ALIAS,
      'updatedAt'
    ]
  )

const buildMySQLLoginMarkerUpsertQuery = (knex, rows) =>
  buildMySQLCounterInsertQuery(
    knex,
    rows,
    '?? = case when ??.?? > ??.?? then ??.?? else ??.?? end, ?? = ??.??',
    [
      'value',
      MYSQL_COUNTER_ALIAS,
      'value',
      'counters',
      'value',
      MYSQL_COUNTER_ALIAS,
      'value',
      'counters',
      'value',
      'updatedAt',
      MYSQL_COUNTER_ALIAS,
      'updatedAt'
    ]
  )

const buildMySQLBackfillMarkerUpsertQuery = (knex, rows) =>
  buildMySQLCounterInsertQuery(knex, rows, '?? = ??.??, ?? = ??.??', [
    'value',
    MYSQL_COUNTER_ALIAS,
    'value',
    'updatedAt',
    MYSQL_COUNTER_ALIAS,
    'updatedAt'
  ])

const upsertBucketRows = async (knex, rows) => {
  if (rows.length === 0) return

  const isMySQL = isMySQLClient(knex)
  const isMariaDB = isMariaDBClient(knex)

  if (isMySQL) {
    await buildMySQLBucketCounterUpsertQuery(knex, rows)
    return
  }

  await knex('counters')
    .insert(rows)
    .onConflict('id')
    .merge({
      value: isMariaDB
        ? knex.raw('?? + VALUES(??)', ['counters.value', 'value'])
        : knex.raw('?? + excluded.??', ['counters.value', 'value']),
      bucketHour: isMariaDB
        ? knex.raw('VALUES(??)', ['bucketHour'])
        : knex.raw('excluded.??', ['bucketHour']),
      updatedAt: isMariaDB
        ? knex.raw('VALUES(??)', ['updatedAt'])
        : knex.raw('excluded.??', ['updatedAt'])
    })
}

const getExistingBackfillValues = async (knex, bucketRows) => {
  if (bucketRows.length === 0) return new Map()

  const markerIds = bucketRows.map((row) => getBackfillCounterId(row.id))
  const rows = await knex('counters')
    .whereIn('id', markerIds)
    .select('id', 'value')

  return new Map(
    rows.map((row) => [
      String(row.id).slice(BACKFILL_COUNTER_PREFIX.length),
      Number(row.value ?? 0)
    ])
  )
}

const upsertBackfillMarkerRows = async (knex, rows) => {
  if (rows.length === 0) return

  const isMySQL = isMySQLClient(knex)
  const isMariaDB = isMariaDBClient(knex)

  if (isMySQL) {
    await buildMySQLBackfillMarkerUpsertQuery(knex, rows)
    return
  }

  await knex('counters')
    .insert(rows)
    .onConflict('id')
    .merge({
      value: isMariaDB
        ? knex.raw('VALUES(??)', ['value'])
        : knex.raw('excluded.??', ['value']),
      updatedAt: isMariaDB
        ? knex.raw('VALUES(??)', ['updatedAt'])
        : knex.raw('excluded.??', ['updatedAt'])
    })
}

const upsertBucketBackfillChunk = async (knex, bucketRows, currentTime) => {
  if (bucketRows.length === 0) return

  const existingBackfillValues = await getExistingBackfillValues(
    knex,
    bucketRows
  )
  const deltaRows = []
  const markerRows = []

  for (const row of bucketRows) {
    const currentValue = Number(row.value)
    const appliedValue = existingBackfillValues.get(row.id) ?? 0
    const delta = currentValue - appliedValue

    if (delta !== 0) {
      deltaRows.push({
        ...row,
        value: delta
      })
    }

    markerRows.push({
      id: getBackfillCounterId(row.id),
      value: currentValue,
      bucketHour: null,
      createdAt: currentTime,
      updatedAt: currentTime
    })
  }

  await knex.transaction(async (trx) => {
    await upsertBucketRows(trx, deltaRows)
    await upsertBackfillMarkerRows(trx, markerRows)
  })
}

const upsertLoginMarkerRows = async (knex, rows) => {
  if (rows.length === 0) return

  const isMySQL = isMySQLClient(knex)
  const isMariaDB = isMariaDBClient(knex)

  if (isMySQL) {
    await buildMySQLLoginMarkerUpsertQuery(knex, rows)
    return
  }

  await knex('counters')
    .insert(rows)
    .onConflict('id')
    .merge({
      value: isMariaDB
        ? knex.raw('CASE WHEN VALUES(??) > ?? THEN VALUES(??) ELSE ?? END', [
            'value',
            'counters.value',
            'value',
            'counters.value'
          ])
        : knex.raw('CASE WHEN excluded.?? > ?? THEN excluded.?? ELSE ?? END', [
            'value',
            'counters.value',
            'value',
            'counters.value'
          ]),
      updatedAt: isMariaDB
        ? knex.raw('VALUES(??)', ['updatedAt'])
        : knex.raw('excluded.??', ['updatedAt'])
    })
}

const upsertCounters = async (knex, counters, currentTime) => {
  const rows = [...counters.values()].map((counter) => ({
    id: counter.id,
    value: counter.value,
    bucketHour: counter.bucketHour ?? null,
    createdAt: currentTime,
    updatedAt: currentTime
  }))
  const bucketRows = rows.filter((row) => row.id.startsWith('bucket:'))
  const markerRows = rows.filter((row) => row.id.startsWith('unique-login:'))

  for (let i = 0; i < bucketRows.length; i += CHUNK_SIZE) {
    await upsertBucketBackfillChunk(
      knex,
      bucketRows.slice(i, i + CHUNK_SIZE),
      currentTime
    )
  }

  for (let i = 0; i < markerRows.length; i += CHUNK_SIZE) {
    await upsertLoginMarkerRows(knex, markerRows.slice(i, i + CHUNK_SIZE))
  }
}

const backfillLocalStatusCounters = async (knex, counters, backfillEnd) => {
  let lastStatusId = ''

  while (true) {
    const statuses = await knex('statuses')
      .join('actors', 'statuses.actorId', 'actors.id')
      .whereNotNull('actors.accountId')
      .where('statuses.id', '>', lastStatusId)
      .select('statuses.id', 'statuses.createdAt')
      .orderBy('statuses.id', 'asc')
      .limit(READ_CHUNK_SIZE)

    if (statuses.length === 0) break

    for (const status of statuses) {
      lastStatusId = status.id
      const createdAt = toDate(status.createdAt)
      if (Number.isNaN(createdAt.getTime())) continue
      if (createdAt >= backfillEnd) continue
      addBucketCounter(counters, 'local-statuses', createdAt)
    }
  }
}

const collectFirstWeeklyLogins = async (knex, backfillEnd) => {
  const firstLoginByWeek = new Map()
  let lastSessionId = ''

  while (true) {
    const sessions = await knex('sessions')
      .whereNotNull('accountId')
      .where('id', '>', lastSessionId)
      .select('id', 'accountId', 'createdAt')
      .orderBy('id', 'asc')
      .limit(READ_CHUNK_SIZE)

    if (sessions.length === 0) break

    for (const session of sessions) {
      lastSessionId = session.id
      if (!session.accountId) continue

      const createdAt = toDate(session.createdAt)
      if (Number.isNaN(createdAt.getTime())) continue
      if (createdAt >= backfillEnd) continue

      const weekKey = getWeekKey(createdAt)
      const weeklyLoginId = `${session.accountId}:${weekKey}`
      const existing = firstLoginByWeek.get(weeklyLoginId)
      if (!existing || createdAt.getTime() < existing.createdAt.getTime()) {
        firstLoginByWeek.set(weeklyLoginId, {
          accountId: session.accountId,
          weekKey,
          createdAt
        })
      }
    }
  }

  return firstLoginByWeek
}

const getExistingLoginMarkerWeeks = async (knex, markerIds) => {
  const existing = new Map()
  if (markerIds.length === 0) return existing

  for (let i = 0; i < markerIds.length; i += CHUNK_SIZE) {
    const rows = await knex('counters')
      .whereIn('id', markerIds.slice(i, i + CHUNK_SIZE))
      .select('id', 'value')

    for (const row of rows) {
      const value = Number(row.value)
      if (Number.isFinite(value)) {
        existing.set(row.id, value)
      }
    }
  }

  return existing
}

const setLoginMarker = (counters, accountId, weekKey, existingWeek) => {
  const markerId = getLoginMarkerId(accountId)
  const currentValue = counters.get(markerId)?.value ?? existingWeek ?? 0
  counters.set(markerId, {
    id: markerId,
    value: Math.max(Number(currentValue), Number(weekKey)),
    bucketHour: null
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const currentTime = new Date()
  const backfillEnd = await getExistingActivityCounterCutoff(knex, currentTime)
  const counters = new Map()

  await backfillLocalStatusCounters(knex, counters, backfillEnd)

  const firstLoginByWeek = await collectFirstWeeklyLogins(knex, backfillEnd)
  const markerIds = [
    ...new Set(
      [...firstLoginByWeek.values()].map((login) =>
        getLoginMarkerId(login.accountId)
      )
    )
  ]
  const existingMarkerWeeks = await getExistingLoginMarkerWeeks(knex, markerIds)
  for (const login of firstLoginByWeek.values()) {
    const markerId = getLoginMarkerId(login.accountId)
    const existingWeek = existingMarkerWeeks.get(markerId)
    if (existingWeek !== Number(login.weekKey)) {
      addBucketCounter(counters, 'logins', login.createdAt)
    }
    setLoginMarker(counters, login.accountId, login.weekKey, existingWeek)
  }

  await upsertCounters(knex, counters, currentTime)
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex('counters')
    .where('id', 'like', 'bucket:local-statuses:%')
    .orWhere('id', 'like', 'bucket:logins:%')
    .orWhere('id', 'like', 'unique-login:%')
    .orWhere('id', 'like', `${BACKFILL_COUNTER_PREFIX}%`)
    .delete()
}

exports.buildMySQLBucketCounterUpsertQuery = buildMySQLBucketCounterUpsertQuery
exports.buildMySQLLoginMarkerUpsertQuery = buildMySQLLoginMarkerUpsertQuery
exports.config = { transaction: false }
