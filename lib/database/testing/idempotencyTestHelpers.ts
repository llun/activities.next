import type { Db } from '@/lib/database/kysely'

// Seeds an `idempotency_keys` row the way keys written before the state column
// were: the column default ('complete'). The first row for a key wins.
export const seedIdempotencyKey = async (
  db: Db,
  {
    actorId,
    key,
    statusId,
    contentHash = null,
    createdAt = new Date()
  }: {
    actorId: string
    key: string
    statusId: string
    contentHash?: string | null
    createdAt?: Date | number
  }
): Promise<void> => {
  await db
    .insertInto('idempotency_keys')
    .values({
      actorId,
      key,
      statusId,
      contentHash,
      createdAt: new Date(createdAt)
    })
    .onConflict((oc) => oc.columns(['actorId', 'key']).doNothing())
    .execute()
}

export const getIdempotencyStatusId = async (
  db: Db,
  { actorId, key }: { actorId: string; key: string }
): Promise<string | null> => {
  const row = await db
    .selectFrom('idempotency_keys')
    .select('statusId')
    .where('actorId', '=', actorId)
    .where('key', '=', key)
    .executeTakeFirst()
  return row ? row.statusId : null
}
