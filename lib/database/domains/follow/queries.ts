import type { Selectable } from 'kysely'

import { getActorFromId } from '@/lib/database/domains/actor/lookups'
import {
  asSQLActor,
  getActor,
  getSqlActorLastStatusAtTime
} from '@/lib/database/domains/actor/rows'
import type {
  CreateFollowParams,
  GetAcceptedFollowTargetActorIdsParams,
  GetAcceptedOrRequestedFollowParams,
  GetAcceptedOrRequestedFollowsWithDomainParams,
  GetFollowFromIdParams,
  GetFollowRequestsCountParams,
  GetFollowRequestsParams,
  GetFollowersInboxParams,
  GetFollowersParams,
  GetFollowingParams,
  GetLocalActorsFromFollowerUrlParams,
  GetLocalFollowersForActorIdParams,
  GetLocalFollowsFromInboxUrlParams,
  UpdateFollowPreferencesParams,
  UpdateFollowStatusParams
} from '@/lib/database/domains/follow/types'
import { backfillListTimelineForMembers } from '@/lib/database/domains/list/timeline'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  getCounterValues,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import type { Follows } from '@/lib/database/kysely/db'
import { jsonText } from '@/lib/database/kysely/dialect'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { pastStoredKeyset } from '@/lib/database/kysely/keyset'
import { selectFollowTargetActorIds } from '@/lib/database/kysely/visibility/followTarget'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { CounterKey } from '@/lib/database/utils/counter'
import { listTimelineKey } from '@/lib/services/timelines/types'
import type { SQLAccount } from '@/lib/types/database/rows'
import type { Actor } from '@/lib/types/domain/actor'
import { type Follow, FollowStatus } from '@/lib/types/domain/follow'

// languages is persisted as a JSON-encoded text column for cross-backend
// portability, so it comes back as a string (or null) and must be parsed.
const parseFollowLanguages = (value: unknown): string[] | null => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : null
  } catch {
    return null
  }
}

// An empty list clears the filter, stored as NULL.
const storedLanguages = (languages: string[] | null | undefined) =>
  languages && languages.length > 0 ? JSON.stringify(languages) : null

const toFollow = (row: Selectable<Follows>): Follow =>
  ({
    ...row,
    // Rows created before this column existed surface as null, which the DB
    // default (true) covers for reblogs.
    reblogs: row.reblogs ?? true,
    notify: Boolean(row.notify),
    languages: parseFollowLanguages(row.languages),
    // Nullable in the schema, but every writer sets both.
    createdAt: row.createdAt ?? 0,
    updatedAt: row.updatedAt ?? 0
  }) as Follow

const LIVE_STATUSES = [FollowStatus.enum.Accepted, FollowStatus.enum.Requested]

export const getFollowFromId = async (
  db: Db,
  { followId }: GetFollowFromIdParams
): Promise<Follow | null> => {
  const row = await db
    .selectFrom('follows')
    .selectAll()
    .where('id', '=', followId)
    .executeTakeFirst()
  return row ? toFollow(row) : null
}

export const getAcceptedOrRequestedFollow = async (
  db: Db,
  { actorId, targetActorId }: GetAcceptedOrRequestedFollowParams
): Promise<Follow | null> => {
  const row = await db
    .selectFrom('follows')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .where('status', 'in', LIVE_STATUSES)
    .limit(1)
    .executeTakeFirst()
  return row ? toFollow(row) : null
}

export const createFollow = async (
  db: Db,
  {
    actorId,
    targetActorId,
    status,
    inbox,
    sharedInbox,
    reblogs = true,
    notify = false,
    languages = null
  }: CreateFollowParams
): Promise<Follow> => {
  const existingFollow = await getAcceptedOrRequestedFollow(db, {
    actorId,
    targetActorId
  })
  if (existingFollow) return existingFollow

  const currentTime = new Date()
  const follow: Follow = {
    id: crypto.randomUUID(),
    actorId,
    actorHost: new URL(actorId).host,
    targetActorId,
    targetActorHost: new URL(targetActorId).host,
    status,
    inbox,
    sharedInbox,
    reblogs,
    notify,
    languages,
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }
  await inTransaction(db, async (trx) => {
    await trx
      .insertInto('follows')
      .values({
        ...follow,
        languages: storedLanguages(languages),
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .execute()

    if (status === FollowStatus.enum.Accepted) {
      await increaseCounterValue(
        trx,
        CounterKey.totalFollowing(actorId),
        1,
        currentTime
      )
      await increaseCounterValue(
        trx,
        CounterKey.totalFollowers(targetActorId),
        1,
        currentTime
      )
    }
  })
  return follow
}

export const updateFollowPreferences = async (
  db: Db,
  {
    actorId,
    targetActorId,
    reblogs,
    notify,
    languages
  }: UpdateFollowPreferencesParams
): Promise<Follow | null> => {
  const existingFollow = await getAcceptedOrRequestedFollow(db, {
    actorId,
    targetActorId
  })
  if (!existingFollow) return null

  // Only persist the preferences the caller actually provided so an update
  // never clobbers fields the client did not mention.
  const updates = {
    ...(reblogs !== undefined ? { reblogs } : {}),
    ...(notify !== undefined ? { notify } : {}),
    ...(languages !== undefined
      ? { languages: storedLanguages(languages) }
      : {})
  }
  if (Object.keys(updates).length === 0) return existingFollow

  const currentTime = new Date()
  await db
    .updateTable('follows')
    .set({ ...updates, updatedAt: currentTime })
    .where('id', '=', existingFollow.id)
    .execute()

  return {
    ...existingFollow,
    ...(reblogs !== undefined ? { reblogs } : {}),
    ...(notify !== undefined ? { notify } : {}),
    // Mirror what is persisted: an empty list clears the filter (null).
    ...(languages !== undefined
      ? { languages: languages && languages.length > 0 ? languages : null }
      : {}),
    updatedAt: currentTime.getTime()
  }
}

export const getLocalFollowersForActorId = async (
  db: Db,
  { targetActorId }: GetLocalFollowersForActorIdParams
): Promise<Follow[]> => {
  const actor = await getActorFromId(db, { id: targetActorId })
  // External actor, all followers are internal
  if (!actor?.privateKey) {
    const rows = await db
      .selectFrom('follows')
      .selectAll()
      .where('targetActorId', '=', targetActorId)
      .where('status', '=', FollowStatus.enum.Accepted)
      .orderBy('createdAt', 'desc')
      .execute()
    return rows.map(toFollow)
  }

  const domains = (
    await db
      .selectFrom('actors')
      .select('domain')
      .distinct()
      .where(isLocalActor)
      .execute()
  ).map((item) => item.domain)
  // An empty list selects nothing; `in ()` is a syntax error on PostgreSQL.
  if (domains.length === 0) return []
  const rows = await db
    .selectFrom('follows')
    .selectAll()
    .where('targetActorId', '=', targetActorId)
    .where('actorHost', 'in', domains)
    .where('status', '=', FollowStatus.enum.Accepted)
    .orderBy('createdAt', 'desc')
    .execute()
  return rows.map(toFollow)
}

export const getLocalFollowsFromInboxUrl = async (
  db: Db,
  { targetActorId, followerInboxUrl }: GetLocalFollowsFromInboxUrlParams
): Promise<Follow[]> => {
  const byInbox = (column: 'inbox' | 'sharedInbox') =>
    db
      .selectFrom('follows')
      .selectAll()
      .where('targetActorId', '=', targetActorId)
      .where(column, '=', followerInboxUrl)
      .execute()
  const followsFromInbox = await byInbox('inbox')
  const followsFromSharedInbox = await byInbox('sharedInbox')
  const uniqueFollows: Record<string, Selectable<Follows>> = {}
  for (const follow of [...followsFromInbox, ...followsFromSharedInbox]) {
    uniqueFollows[follow.id] = follow
  }
  return Object.values(uniqueFollows).map(toFollow)
}

export const getLocalActorsFromFollowerUrl = async (
  db: Db,
  { followerUrl }: GetLocalActorsFromFollowerUrlParams
): Promise<Actor[]> => {
  const actor = await db
    .selectFrom('actors')
    .select('id')
    .where(jsonText(db, 'actors.settings', 'followersUrl'), '=', followerUrl)
    .limit(1)
    .executeTakeFirst()
  if (!actor?.id) return []

  return inTransaction(db, async (trx) => {
    const localActors = await trx
      .selectFrom('actors')
      .leftJoin('follows', 'follows.actorId', 'actors.id')
      .selectAll('actors')
      .where('follows.targetActorId', '=', actor.id)
      .where('follows.status', '=', FollowStatus.enum.Accepted)
      .where(isLocalActor)
      .execute()
    const result: Actor[] = []
    for (const row of localActors) {
      const localActor = asSQLActor(row)
      const localActorId = localActor.id
      const account = localActor.accountId
        ? await trx
            .selectFrom('accounts')
            .selectAll()
            .where('id', '=', localActor.accountId)
            .executeTakeFirst()
        : undefined
      const counters = await getCounterValues(trx, [
        CounterKey.totalFollowers(localActorId),
        CounterKey.totalFollowing(localActorId),
        CounterKey.totalStatus(localActorId)
      ])
      result.push(
        getActor(
          localActor,
          counters[CounterKey.totalFollowing(localActorId)] ?? 0,
          counters[CounterKey.totalFollowers(localActorId)] ?? 0,
          counters[CounterKey.totalStatus(localActorId)] ?? 0,
          // 0 when unset, as before: a truthiness check, so a SQLite empty
          // string (which the driver reads as NaN) is 0 too.
          getSqlActorLastStatusAtTime(localActor),
          account as SQLAccount | undefined
        )
      )
    }
    return result
  })
}

export const getAcceptedOrRequestedFollowsWithDomain = async (
  db: Db,
  { actorId, domain, limit }: GetAcceptedOrRequestedFollowsWithDomainParams
): Promise<Follow[]> => {
  // Both directions on the indexed host columns: the actor's own follows
  // of accounts on the domain, and followers from the domain.
  const rows = await db
    .selectFrom('follows')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb.and([
          eb('actorId', '=', actorId),
          eb('targetActorHost', '=', domain)
        ]),
        eb.and([
          eb('targetActorId', '=', actorId),
          eb('actorHost', '=', domain)
        ])
      ])
    )
    .where('status', 'in', LIVE_STATUSES)
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .execute()
  return rows.map(toFollow)
}

export const getAcceptedFollowTargetActorIds = (
  db: Db,
  { actorId, targetActorIds }: GetAcceptedFollowTargetActorIdsParams
): Promise<string[]> =>
  selectFollowTargetActorIds(db, actorId, targetActorIds, [
    FollowStatus.enum.Accepted
  ])

export const getFollowersInbox = async (
  db: Db,
  { targetActorId }: GetFollowersInboxParams
): Promise<string[]> => {
  const follows = await db
    .selectFrom('follows')
    .select(['inbox', 'sharedInbox'])
    .where('targetActorId', '=', targetActorId)
    .where('status', '=', FollowStatus.enum.Accepted)
    .execute()
  const inboxes = new Set<string>()
  for (const follow of follows) {
    // Every follow writer stores an inbox; the column itself is nullable.
    inboxes.add((follow.sharedInbox || follow.inbox) as string)
  }
  return Array.from(inboxes)
}

export const updateFollowStatus = async (
  db: Db,
  { followId, status }: UpdateFollowStatusParams
): Promise<void> => {
  const currentTime = new Date()
  await inTransaction(db, async (trx) => {
    const existingFollow = await trx
      .selectFrom('follows')
      .selectAll()
      .where('id', '=', followId)
      .executeTakeFirst()
    if (!existingFollow) return
    // The follow writers always set both ends; the columns are nullable.
    const actorId = existingFollow.actorId as string
    const targetActorId = existingFollow.targetActorId as string

    await trx
      .updateTable('follows')
      .set({ status, updatedAt: currentTime })
      .where('id', '=', followId)
      .execute()

    const wasAccepted = existingFollow.status === FollowStatus.enum.Accepted
    const isAccepted = status === FollowStatus.enum.Accepted

    if (!wasAccepted && isAccepted) {
      await increaseCounterValue(
        trx,
        CounterKey.totalFollowing(actorId),
        1,
        currentTime
      )
      await increaseCounterValue(
        trx,
        CounterKey.totalFollowers(targetActorId),
        1,
        currentTime
      )
    }

    if (wasAccepted && !isAccepted) {
      await decreaseCounterValue(
        trx,
        CounterKey.totalFollowing(actorId),
        1,
        currentTime
      )
      await decreaseCounterValue(
        trx,
        CounterKey.totalFollowers(targetActorId),
        1,
        currentTime
      )
    }

    // A list member the owner had only requested to follow joined the list
    // without its posts. Now that the request is accepted, bring its stored
    // posts into each of the owner's lists that hold it, as Mastodon's
    // FollowRequest#authorize! merges the account into those lists. The owner
    // is the follower (actorId) and the member the followed (targetActorId). A
    // follow of oneself is skipped: the owner's membership of their own list
    // never waited on it.
    if (!wasAccepted && isAccepted && actorId !== targetActorId) {
      const memberships = await trx
        .selectFrom('list_accounts')
        .select('listId')
        .where('actorId', '=', actorId)
        .where('targetActorId', '=', targetActorId)
        .execute()
      for (const membership of memberships) {
        await backfillListTimelineForMembers(trx, {
          listId: membership.listId,
          ownerId: actorId,
          targetActorIds: [targetActorId]
        })
      }
    }

    // Mastodon ties list membership to the follow, or to the request while it
    // is pending (a ListAccount cascades with its Follow or FollowRequest), so
    // either one ending — undone, withdrawn or rejected, a Reject also being
    // how a remote account removes a follower — removes the account from all
    // of the owner's lists. List membership is the source of truth for the
    // list timeline, so dropping the membership (and the materialized
    // list-feed rows it produced) is all that's needed. This keys on the
    // transition out of a live status rather than on the new status alone:
    // the inbox resolves a Reject to its follow row by id whatever that row's
    // status, so a late Reject of a request the owner already withdrew must
    // not remove a membership a newer request now backs. A user has few
    // lists, so this is a small indexed delete on a rare action. The one
    // membership no follow backs is the owner's own (a list owner may add
    // themselves), so ending a self-follow leaves it alone.
    const wasLive =
      existingFollow.status === FollowStatus.enum.Accepted ||
      existingFollow.status === FollowStatus.enum.Requested
    const endsFollow =
      status === FollowStatus.enum.Undo || status === FollowStatus.enum.Rejected
    if (wasLive && endsFollow && actorId !== targetActorId) {
      const memberships = await trx
        .selectFrom('list_accounts')
        .select('listId')
        .where('actorId', '=', actorId)
        .where('targetActorId', '=', targetActorId)
        .execute()
      if (memberships.length > 0) {
        await trx
          .deleteFrom('list_accounts')
          .where('actorId', '=', actorId)
          .where('targetActorId', '=', targetActorId)
          .execute()
        // Purge the member's posts from each of the owner's list partitions.
        // The `in` on the list keys is what scopes this to lists — without it
        // the (actorId, statusActorId) delete would also wipe the member's
        // posts from the owner's home feed (timeline='main'). The keys are
        // chunked (reserving the actorId + statusActorId bindings) so an owner
        // with very many lists can't exceed SQLite's bound-parameter limit.
        const timelineKeys = memberships.map((row) =>
          listTimelineKey(row.listId)
        )
        for (const keyChunk of chunkArray(
          timelineKeys,
          getWhereInBatchSize(trx, 2)
        )) {
          await trx
            .deleteFrom('timelines')
            .where('actorId', '=', actorId)
            .where('statusActorId', '=', targetActorId)
            .where('timeline', 'in', keyChunk)
            .execute()
        }
      }
    }
  })
}

// getFollowing / getFollowers page on the follow id alone: min_id returns the
// OLDEST band immediately after the cursor (ascending), presented
// newest-first; max_id/since_id/none return the newest band.
const getAcceptedFollowPage = async (
  db: Db,
  column: 'actorId' | 'targetActorId',
  actorId: string,
  {
    limit,
    maxId,
    minId,
    sinceId
  }: Pick<GetFollowingParams, 'limit' | 'maxId' | 'minId' | 'sinceId'>
): Promise<Follow[]> => {
  let query = db
    .selectFrom('follows')
    .selectAll()
    .where(column, '=', actorId)
    .where('status', '=', FollowStatus.enum.Accepted)
  if (maxId) query = query.where('id', '<', maxId)
  if (minId) query = query.where('id', '>', minId)
  if (sinceId) query = query.where('id', '>', sinceId)

  const rows = await query
    .orderBy('id', minId ? 'asc' : 'desc')
    .limit(limit)
    .execute()
  if (minId) rows.reverse()
  return rows.map(toFollow)
}

export const getFollowing = (
  db: Db,
  { actorId, ...page }: GetFollowingParams
): Promise<Follow[]> => getAcceptedFollowPage(db, 'actorId', actorId, page)

export const getFollowers = (
  db: Db,
  { targetActorId, ...page }: GetFollowersParams
): Promise<Follow[]> =>
  getAcceptedFollowPage(db, 'targetActorId', targetActorId, page)

export const getFollowRequests = async (
  db: Db,
  { targetActorId, limit, maxId, minId, sinceId }: GetFollowRequestsParams
): Promise<Follow[]> => {
  // Cursor pagination on (createdAt, id): follow ids are random UUIDs, so the
  // createdAt-first ordering (with id as a stable tiebreaker) is what makes the
  // page genuinely newest-first. Mirrors getBlocks/getMutes.
  let query = db
    .selectFrom('follows')
    .selectAll()
    .where('targetActorId', '=', targetActorId)
    .where('status', '=', FollowStatus.enum.Requested)

  const cursorId = maxId || minId || sinceId
  if (cursorId) {
    // Look up the cursor row by owner + id only (mirroring getBlocks'
    // `{ actorId, id }`). The status is deliberately NOT filtered here: the
    // cursor only supplies a (createdAt, id) keyset boundary, so pagination
    // must stay correct even if the boundary request was authorized/rejected
    // between page fetches. The main query above still returns Requested rows
    // only, so no non-pending rows leak into the results.
    const cursor = await db
      .selectFrom('follows')
      .select(['id', 'createdAt'])
      .where('targetActorId', '=', targetActorId)
      .where('id', '=', cursorId)
      .executeTakeFirst()
    if (!cursor) return []
    const past = { createdAt: cursor.createdAt, tieBreaker: cursor.id }
    const operator = maxId ? '<' : '>'
    query = query.where((eb) => pastStoredKeyset(eb, past, operator, 'id'))
  }

  const direction = minId ? 'asc' : 'desc'
  const rows = await query
    .orderBy('createdAt', direction)
    .orderBy('id', direction)
    .limit(limit)
    .execute()
  if (minId) rows.reverse()
  return rows.map(toFollow)
}

export const getFollowRequestsCount = async (
  db: Db,
  { targetActorId }: GetFollowRequestsCountParams
): Promise<number> => {
  const row = await db
    .selectFrom('follows')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('targetActorId', '=', targetActorId)
    .where('status', '=', FollowStatus.enum.Requested)
    .executeTakeFirst()
  // count(*) is an expression column: a string on PostgreSQL's int8, a number
  // on SQLite.
  return Number(row?.count ?? 0)
}

// The follow facade methods as `(db, params)` queries.
export const followQueries = {
  createFollow,
  updateFollowPreferences,
  getFollowFromId,
  getLocalFollowersForActorId,
  getLocalFollowsFromInboxUrl,
  getLocalActorsFromFollowerUrl,
  getAcceptedOrRequestedFollow,
  getAcceptedOrRequestedFollowsWithDomain,
  getAcceptedFollowTargetActorIds,
  getFollowersInbox,
  updateFollowStatus,
  getFollowing,
  getFollowers,
  getFollowRequests,
  getFollowRequestsCount
}
