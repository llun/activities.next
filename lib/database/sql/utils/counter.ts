import { Knex } from 'knex'

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER
const MAX_ADJUST_RETRIES = 100

type CounterRow = {
  id: string
  value: number | string | null
}

const clampCounterValue = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value > MAX_SAFE_INTEGER) return MAX_SAFE_INTEGER
  return Math.floor(value)
}

export const parseCounterValue = (
  value: number | string | bigint | null | undefined
): number => {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return clampCounterValue(value)
  if (typeof value === 'bigint') return clampCounterValue(Number(value))

  const parsed = Number.parseInt(value, 10)
  return clampCounterValue(Number.isNaN(parsed) ? 0 : parsed)
}

export const CounterKey = {
  totalStatus: (actorId: string) => `total-status:${actorId}`,
  totalFollowers: (actorId: string) => `total-followers:${actorId}`,
  totalFollowing: (actorId: string) => `total-following:${actorId}`,
  totalLike: (statusId: string) => `total-like:${statusId}`,
  totalReblog: (statusId: string) => `total-reblog:${statusId}`,
  totalReply: (statusId: string) => `total-reply:${statusId}`,
  mediaUsage: (accountId: string) => `media-usage:${accountId}`,
  totalMedia: (accountId: string) => `total-media:${accountId}`
}

type SQLDatabase = Knex | Knex.Transaction

const ensureCounterRow = async (
  database: SQLDatabase,
  id: string,
  currentTime: Date
) => {
  await database('counters')
    .insert({
      id,
      value: 0,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict('id')
    .ignore()
}

export const getCounterValue = async (
  database: SQLDatabase,
  id: string
): Promise<number> => {
  const row = await database<CounterRow>('counters').where('id', id).first()
  return parseCounterValue(row?.value)
}

export const getCounterValues = async (
  database: SQLDatabase,
  ids: string[]
): Promise<Record<string, number>> => {
  if (ids.length === 0) return {}

  const rows = await database<CounterRow>('counters')
    .whereIn('id', ids)
    .select('id', 'value')

  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.id] = parseCounterValue(row.value)
  }

  return result
}

export const setCounterValue = async (
  database: SQLDatabase,
  id: string,
  value: number,
  currentTime = new Date()
): Promise<void> => {
  const nextValue = clampCounterValue(value)

  await database('counters')
    .insert({
      id,
      value: nextValue,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .onConflict('id')
    .merge({
      value: nextValue,
      updatedAt: currentTime
    })
}

const adjustCounterValue = async (
  database: SQLDatabase,
  id: string,
  delta: number,
  currentTime = new Date()
): Promise<void> => {
  if (delta === 0) return

  await ensureCounterRow(database, id, currentTime)

  for (let attempt = 0; attempt < MAX_ADJUST_RETRIES; attempt += 1) {
    const existing = await database<CounterRow>('counters')
      .where('id', id)
      .first('value')

    if (!existing) {
      await ensureCounterRow(database, id, currentTime)
      continue
    }

    const nextValue = clampCounterValue(
      parseCounterValue(existing.value) + delta
    )
    const updated = await database('counters')
      .where('id', id)
      .andWhere('value', existing.value)
      .update({
        value: nextValue,
        updatedAt: currentTime
      })

    if (updated > 0) {
      return
    }
  }

  throw new Error(`Failed to adjust counter "${id}" after concurrent updates`)
}

export const increaseCounterValue = async (
  database: SQLDatabase,
  id: string,
  amount = 1,
  currentTime = new Date()
): Promise<void> =>
  adjustCounterValue(database, id, Math.abs(amount), currentTime)

export const decreaseCounterValue = async (
  database: SQLDatabase,
  id: string,
  amount = 1,
  currentTime = new Date()
): Promise<void> =>
  adjustCounterValue(database, id, -Math.abs(amount), currentTime)

export const deleteCounterValue = async (
  database: SQLDatabase,
  id: string
): Promise<void> => {
  await database('counters').where('id', id).delete()
}
