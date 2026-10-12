// Reading actors: by id, e-mail, username or publicId, their settings and
// notification policy, and their deletion state.
import {
  getActorCounters,
  getActorCountersByActorId
} from '@/lib/database/domains/actor/counters'
import {
  type ActorCounters,
  EMPTY_ACTOR_COUNTERS,
  asSQLActor,
  getActor,
  getSqlActorLastStatusAtTime
} from '@/lib/database/domains/actor/rows'
import type {
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  GetActorIdByPublicIdParams,
  GetActorIdsByPublicIdsParams,
  GetActorPublicIdsParams,
  GetActorSettingsParams,
  GetActorsFromIdsParams,
  GetActorsScheduledForDeletionParams,
  IsCurrentActorFollowingParams
} from '@/lib/database/domains/actor/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { findActorRowByUsername } from '@/lib/database/kysely/usernameMatch'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import {
  resolveIdsByPublicIds,
  resolvePublicIdsByIds
} from '@/lib/database/utils/publicIdLookup'
import {
  DEFAULT_NOTIFICATION_POLICY,
  type NotificationPolicy
} from '@/lib/types/database/operations'
import type {
  ActorSettings,
  SQLAccount,
  SQLActor
} from '@/lib/types/database/rows'
import type { Actor } from '@/lib/types/domain/actor'
import { toPublicIdLookupKey } from '@/lib/utils/publicId'

const selectActor = (db: Db) =>
  db.selectFrom('actors').selectAll('actors').$narrowType<{ id: string }>()

// An actor without an account (accountId NULL) matches no account row.
const selectAccount = async (db: Db, accountId: string | null) =>
  accountId
    ? db
        .selectFrom('accounts')
        .selectAll()
        .where('id', '=', accountId)
        .limit(1)
        .executeTakeFirst()
    : undefined

const toActor = (
  sqlActor: SQLActor,
  counters: ActorCounters,
  sqlAccount?: object
) =>
  getActor(
    sqlActor,
    counters.followingCount,
    counters.followersCount,
    counters.statusCount,
    getSqlActorLastStatusAtTime(sqlActor),
    sqlAccount as SQLAccount | undefined
  )

// The account and the counters of a found actor, read in one transaction.
const toActorWithAccount = async (db: Db, sqlActor: SQLActor) => {
  const [account, counters] = await inTransaction(db, (trx) =>
    Promise.all([
      selectAccount(trx, sqlActor.accountId),
      getActorCounters(trx, sqlActor.id)
    ])
  )
  return toActor(sqlActor, counters, account)
}

export const getActorFromId = async (
  db: Db,
  { id }: GetActorFromIdParams
): Promise<Actor | null> => {
  const row = await selectActor(db)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  const sqlActor = asSQLActor(row)

  if (!sqlActor.accountId) {
    return toActor(sqlActor, await getActorCounters(db, sqlActor.id))
  }
  return toActorWithAccount(db, sqlActor)
}

export const getActorFromEmail = async (
  db: Db,
  { email }: GetActorFromEmailParams
): Promise<Actor | null> => {
  const row = await selectActor(db)
    .leftJoin('accounts', 'actors.accountId', 'accounts.id')
    .where('accounts.email', '=', email)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  return toActorWithAccount(db, asSQLActor(row))
}

export const getActorFromUsername = async (
  db: Db,
  { username, domain }: GetActorFromUsernameParams
): Promise<Actor | null> => {
  // Case-insensitive: a handle reaches this from a URL path, a mention, a
  // WebFinger resource and a search box, and none of them control casing.
  // See findActorRowByUsername for why the exact match is still tried first.
  const row = await findActorRowByUsername(db, { username, domain })
  if (!row) return null
  return toActorWithAccount(db, asSQLActor(row))
}

export const getActorsFromIds = async (
  db: Db,
  { ids }: GetActorsFromIdsParams
): Promise<Actor[]> => {
  const actorIds = [...new Set(ids)]
  if (actorIds.length === 0) return []

  const rows = await selectActor(db).where('id', 'in', actorIds).execute()
  const actorById = new Map(rows.map((row) => [row.id, asSQLActor(row)]))
  const accountIds = [
    ...new Set(
      rows
        .map((row) => row.accountId)
        .filter((accountId): accountId is string => Boolean(accountId))
    )
  ]
  const [accounts, countersByActorId] = await Promise.all([
    accountIds.length > 0
      ? db
          .selectFrom('accounts')
          .selectAll()
          .where('id', 'in', accountIds)
          .execute()
      : [],
    getActorCountersByActorId(db, actorIds)
  ])
  const accountById = new Map(accounts.map((account) => [account.id, account]))

  return actorIds.flatMap((actorId) => {
    const sqlActor = actorById.get(actorId)
    if (!sqlActor) return []
    return [
      toActor(
        sqlActor,
        countersByActorId.get(actorId) ?? EMPTY_ACTOR_COUNTERS,
        sqlActor.accountId ? accountById.get(sqlActor.accountId) : undefined
      )
    ]
  })
}

// The lookup parameter is normalized here, at the single choke point every
// resolution site goes through, rather than in each caller — see
// toPublicIdLookupKey.
export const getActorIdByPublicId = async (
  db: Db,
  { publicId }: GetActorIdByPublicIdParams
): Promise<string | null> => {
  const row = await db
    .selectFrom('actors')
    .select('id')
    .where('publicId', '=', toPublicIdLookupKey(publicId))
    .limit(1)
    .executeTakeFirst()
  return row?.id ?? null
}

// Batch counterpart of getActorIdByPublicId, so a request carrying an array
// of ids costs one query instead of one per id. The returned map is keyed by
// the publicIds as REQUESTED, so callers can zip it back against their input.
export const getActorIdsByPublicIds = (
  db: Db,
  { publicIds }: GetActorIdsByPublicIdsParams
): Promise<Map<string, string>> =>
  resolveIdsByPublicIds({
    publicIds,
    batchSize: getWhereInBatchSize(db),
    selectChunk: (lookupKeys) =>
      db
        .selectFrom('actors')
        .select(['id', 'publicId'])
        .where('publicId', 'in', lookupKeys)
        .$narrowType<{ id: string; publicId: string }>()
        .execute()
  })

export const getActorPublicIds = (
  db: Db,
  { actorIds }: GetActorPublicIdsParams
): Promise<Map<string, string>> =>
  resolvePublicIdsByIds({
    ids: actorIds,
    batchSize: getWhereInBatchSize(db),
    selectChunk: (ids) =>
      db
        .selectFrom('actors')
        .select(['id', 'publicId'])
        .where('id', 'in', ids)
        .where('publicId', 'is not', null)
        .$narrowType<{ id: string; publicId: string }>()
        .execute()
  })

export const isCurrentActorFollowing = async (
  db: Db,
  { currentActorId, followingActorId }: IsCurrentActorFollowingParams
): Promise<boolean> => {
  const result = await db
    .selectFrom('follows')
    .select((eb) => eb.fn.count('id').as('count'))
    .where('actorId', '=', currentActorId)
    .where('targetActorId', '=', followingActorId)
    .where('status', '=', 'Accepted')
    .executeTakeFirst()
  return Number(result?.count ?? 0) > 0
}

export const getActorSettings = async (
  db: Db,
  { actorId }: GetActorSettingsParams
): Promise<ActorSettings | undefined> => {
  const row = await db
    .selectFrom('actors')
    .select('settings')
    .where('id', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  if (!row) return undefined
  return getCompatibleJSON(row.settings as string | ActorSettings)
}

// Mastodon defaults for every key the actor has not set.
export const getNotificationPolicy = async (
  db: Db,
  { actorId }: GetActorSettingsParams
): Promise<NotificationPolicy> => {
  const settings = await getActorSettings(db, { actorId })
  return {
    ...DEFAULT_NOTIFICATION_POLICY,
    ...(settings?.notificationPolicy ?? {})
  }
}

export const getActorDeletionStatus = async (
  db: Db,
  { id }: GetActorFromIdParams
): Promise<
  { status: string | null; scheduledAt: number | null } | undefined
> => {
  const row = await db
    .selectFrom('actors')
    .select(['deletionStatus', 'deletionScheduledAt'])
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  if (!row) return undefined
  return {
    status: row.deletionStatus ?? null,
    scheduledAt: row.deletionScheduledAt
  }
}

export const getActorsScheduledForDeletion = async (
  db: Db,
  { beforeDate }: GetActorsScheduledForDeletionParams
): Promise<Actor[]> => {
  const rows = await db
    .selectFrom('actors')
    .select('id')
    .$narrowType<{ id: string }>()
    .where('deletionStatus', '=', 'scheduled')
    .where('deletionScheduledAt', '<=', timestampValue(beforeDate))
    .execute()

  const results: Actor[] = []
  for (const row of rows) {
    const actor = await getActorFromId(db, { id: row.id })
    if (actor) results.push(actor)
  }
  return results
}
