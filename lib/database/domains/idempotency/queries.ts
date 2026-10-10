import type {
  GetIdempotentStatusIdParams,
  SaveIdempotencyKeyParams
} from '@/lib/database/domains/idempotency/types'
import type { Db } from '@/lib/database/kysely'

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

export const saveIdempotencyKey = async (
  db: Db,
  { actorId, key, statusId }: SaveIdempotencyKeyParams
): Promise<void> => {
  // Ignore on conflict so a concurrent request that already recorded the same
  // (actorId, key) does not surface a primary-key violation. The first writer
  // wins; this keeps the call safe under retries/races.
  await db
    .insertInto('idempotency_keys')
    .values({ actorId, key, statusId, createdAt: new Date() })
    .onConflict((oc) => oc.columns(['actorId', 'key']).doNothing())
    .execute()
}

export const idempotencyQueries = { getIdempotentStatusId, saveIdempotencyKey }
