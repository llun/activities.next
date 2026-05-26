const CHUNK_SIZE = 100
const READ_CHUNK_SIZE = 1000
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

const upsertCounters = async (knex, counters, currentTime) => {
  const rows = [...counters.values()].map((counter) => ({
    id: counter.id,
    value: counter.value,
    bucketHour: counter.bucketHour ?? null,
    createdAt: currentTime,
    updatedAt: currentTime
  }))

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    await knex('counters')
      .insert(chunk)
      .onConflict('id')
      .merge(['value', 'bucketHour', 'updatedAt'])
  }
}

const backfillLocalStatusCounters = async (knex, counters) => {
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
      addBucketCounter(counters, 'local-statuses', createdAt)
    }
  }
}

const collectFirstWeeklyLogins = async (knex) => {
  const firstLoginByMarker = new Map()
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

      const markerId = `unique-login:${getWeekKey(createdAt)}:${session.accountId}`
      const existing = firstLoginByMarker.get(markerId)
      if (!existing || createdAt.getTime() < existing.createdAt.getTime()) {
        firstLoginByMarker.set(markerId, {
          accountId: session.accountId,
          createdAt
        })
      }
    }
  }

  return firstLoginByMarker
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const currentTime = new Date()
  const counters = new Map()

  await backfillLocalStatusCounters(knex, counters)

  const firstLoginByMarker = await collectFirstWeeklyLogins(knex)
  for (const [markerId, login] of firstLoginByMarker.entries()) {
    counters.set(markerId, {
      id: markerId,
      value: 1,
      bucketHour: null
    })
    addBucketCounter(counters, 'logins', login.createdAt)
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
    .delete()
}
