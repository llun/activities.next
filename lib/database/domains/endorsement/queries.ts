import type {
  CreateEndorsementParams,
  DeleteEndorsementParams,
  GetEndorsementParams,
  GetEndorsementsParams
} from '@/lib/database/domains/endorsement/types'
import type { Db } from '@/lib/database/kysely'
import { Endorsement } from '@/lib/types/domain/endorsement'

const COLUMNS = [
  'id',
  'actorId',
  'actorHost',
  'targetActorId',
  'targetActorHost',
  'createdAt'
] as const

type Row = {
  id: number
  actorId: string
  actorHost: string
  targetActorId: string
  targetActorHost: string
  createdAt: number | null
}

const toEndorsement = (row: Row): Endorsement =>
  Endorsement.parse({
    id: `${row.id}`,
    actorId: row.actorId,
    actorHost: row.actorHost,
    targetActorId: row.targetActorId,
    targetActorHost: row.targetActorHost,
    createdAt: row.createdAt ?? 0
  })

export const getEndorsement = async (
  db: Db,
  { actorId, targetActorId }: GetEndorsementParams
): Promise<Endorsement | null> => {
  const row = await db
    .selectFrom('endorsements')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .limit(1)
    .executeTakeFirst()
  return row ? toEndorsement(row) : null
}

export const createEndorsement = async (
  db: Db,
  { actorId, targetActorId }: CreateEndorsementParams
): Promise<Endorsement> => {
  // Idempotent: ignore on the (actorId, targetActorId) unique index, then
  // read back so concurrent endorse requests resolve to the same row.
  await db
    .insertInto('endorsements')
    .values({
      actorId,
      actorHost: new URL(actorId).host,
      targetActorId,
      targetActorHost: new URL(targetActorId).host,
      createdAt: new Date()
    })
    .onConflict((oc) => oc.columns(['actorId', 'targetActorId']).doNothing())
    .execute()

  const endorsement = await getEndorsement(db, { actorId, targetActorId })
  // The row always exists after the insert/ignore above.
  return endorsement as Endorsement
}

export const deleteEndorsement = async (
  db: Db,
  { actorId, targetActorId }: DeleteEndorsementParams
): Promise<void> => {
  await db
    .deleteFrom('endorsements')
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .execute()
}

export const getEndorsements = async (
  db: Db,
  { actorId, limit, maxId, minId, sinceId }: GetEndorsementsParams
): Promise<Endorsement[]> => {
  let query = db
    .selectFrom('endorsements')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .limit(limit)

  // Numeric id cursors; a truthiness check guards both null/undefined and the
  // empty-string case (`?max_id=`), which would otherwise compare against 0.
  const max = maxId ? Number(maxId) : NaN
  const min = minId ? Number(minId) : NaN
  const since = sinceId ? Number(sinceId) : NaN
  if (!Number.isNaN(max)) query = query.where('id', '<', max)
  if (!Number.isNaN(min)) query = query.where('id', '>', min)
  if (!Number.isNaN(since)) query = query.where('id', '>', since)

  // min_id returns the OLDEST band immediately after the cursor: fetch
  // ascending (closest to the cursor), then present newest-first. Every other
  // cursor (max_id, since_id, none) returns the newest band, descending.
  if (!Number.isNaN(min)) {
    const rows = await query.orderBy('id', 'asc').execute()
    return rows.reverse().map(toEndorsement)
  }
  const rows = await query.orderBy('id', 'desc').execute()
  return rows.map(toEndorsement)
}

export const endorsementQueries = {
  createEndorsement,
  deleteEndorsement,
  getEndorsement,
  getEndorsements
}
