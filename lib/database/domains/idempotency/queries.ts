import {
  type DeleteExpiredIdempotencyKeysParams,
  type GetIdempotentStatusIdParams,
  IDEMPOTENCY_KEY_TTL_MS,
  type IdempotencyKeyRecord,
  type IdempotencyKeyState,
  type SaveIdempotencyKeyParams,
  type SetIdempotencyKeyStateParams
} from '@/lib/database/domains/idempotency/types'
import type { Db } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'

export const getIdempotentStatusId = async (
  db: Db,
  { actorId, key }: GetIdempotentStatusIdParams
): Promise<string | null> => {
  const row = await db
    .selectFrom('idempotency_keys')
    .select('statusId')
    .where('actorId', '=', actorId)
    .where('key', '=', key)
    .limit(1)
    .executeTakeFirst()
  return row ? row.statusId : null
}

export const getIdempotencyKey = async (
  db: Db,
  { actorId, key }: GetIdempotentStatusIdParams
): Promise<IdempotencyKeyRecord | null> => {
  const row = await db
    .selectFrom('idempotency_keys')
    .select(['actorId', 'key', 'statusId', 'contentHash', 'state', 'createdAt'])
    .where('actorId', '=', actorId)
    .where('key', '=', key)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  return {
    actorId: row.actorId,
    key: row.key,
    statusId: row.statusId,
    contentHash: row.contentHash ?? null,
    state: row.state as IdempotencyKeyState,
    createdAt: row.createdAt ?? null
  }
}

export const saveIdempotencyKey = async (
  db: Db,
  {
    actorId,
    key,
    statusId,
    contentHash = null,
    createdAt
  }: SaveIdempotencyKeyParams
): Promise<void> => {
  const createdAtDate =
    createdAt instanceof Date
      ? createdAt
      : createdAt !== undefined
        ? new Date(createdAt)
        : new Date()
  // Ignore on conflict so a concurrent request that already recorded the same
  // (actorId, key) does not surface a primary-key violation. The first writer
  // wins; this keeps the call safe under retries/races.
  await db
    .insertInto('idempotency_keys')
    .values({
      actorId,
      key,
      statusId,
      contentHash,
      createdAt: createdAtDate
    })
    .onConflict((oc) => oc.columns(['actorId', 'key']).doNothing())
    .execute()
}

export const setIdempotencyKeyState = async (
  db: Db,
  { actorId, key, statusId, state }: SetIdempotencyKeyStateParams
): Promise<void> => {
  await db
    .updateTable('idempotency_keys')
    .set({ state })
    .where('actorId', '=', actorId)
    .where('key', '=', key)
    .where('statusId', '=', statusId)
    .execute()
}

export const deleteExpiredIdempotencyKeys = async (
  db: Db,
  {
    olderThan = new Date(Date.now() - IDEMPOTENCY_KEY_TTL_MS)
  }: DeleteExpiredIdempotencyKeysParams = {}
): Promise<number> => {
  const { numDeletedRows } = await db
    .deleteFrom('idempotency_keys')
    .where('createdAt', '<', timestampValue(olderThan))
    .executeTakeFirst()
  return Number(numDeletedRows)
}

export const idempotencyQueries = {
  getIdempotentStatusId,
  getIdempotencyKey,
  saveIdempotencyKey,
  setIdempotencyKeyState,
  deleteExpiredIdempotencyKeys
}
