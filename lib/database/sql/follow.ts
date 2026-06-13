import { Knex } from 'knex'

import { SQLActorDatabase } from '@/lib/database/sql/actor'
import {
  CounterKey,
  decreaseCounterValue,
  getCounterValues,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { listTimelineKey } from '@/lib/services/timelines/types'
import {
  CreateFollowParams,
  FollowDatabase,
  GetAcceptedFollowTargetActorIdsParams,
  GetAcceptedOrRequestedFollowParams,
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
} from '@/lib/types/database/operations'
import { Account } from '@/lib/types/domain/account'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'

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

// Cursor comparison for follow_requests pagination. Mirrors the block/mute
// `applyCursor` helpers: order on (createdAt, id) so a random-UUID id can still
// be paginated newest-first, with id breaking createdAt ties. Per-module copies
// of this helper are the established convention across the sql/ mixins.
const applyFollowCursor = (
  query: Knex.QueryBuilder,
  cursor: Follow,
  direction: 'newer' | 'older'
) => {
  const operator = direction === 'older' ? '<' : '>'

  query.andWhere((builder) => {
    builder
      .where('createdAt', operator, cursor.createdAt)
      .orWhere((tieBreaker) => {
        tieBreaker
          .where('createdAt', cursor.createdAt)
          .andWhere('id', operator, cursor.id)
      })
  })
}

const fixFollowDataDate = (data: Follow): Follow => ({
  ...data,
  // SQLite stores booleans as 0/1; coerce back to real booleans. Rows created
  // before this column existed surface as null, which the DB default (true)
  // covers for reblogs.
  reblogs:
    data.reblogs === null || data.reblogs === undefined
      ? true
      : Boolean(data.reblogs),
  notify: Boolean(data.notify),
  languages: parseFollowLanguages(data.languages),
  createdAt: getCompatibleTime(data.createdAt),
  updatedAt: getCompatibleTime(data.updatedAt)
})

export const FollowerSQLDatabaseMixin = (
  database: Knex,
  actorDatabase: SQLActorDatabase
): FollowDatabase => ({
  async createFollow({
    actorId,
    targetActorId,
    status,
    inbox,
    sharedInbox,
    reblogs = true,
    notify = false,
    languages = null
  }: CreateFollowParams) {
    const existingFollow = await this.getAcceptedOrRequestedFollow({
      actorId,
      targetActorId
    })
    if (existingFollow) {
      return existingFollow
    }

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
    await database.transaction(async (trx) => {
      await trx('follows').insert({
        ...follow,
        inbox,
        sharedInbox,
        languages:
          languages && languages.length > 0 ? JSON.stringify(languages) : null,
        createdAt: currentTime,
        updatedAt: currentTime
      })

      if (status === FollowStatus.enum.Accepted) {
        await Promise.all([
          increaseCounterValue(
            trx,
            CounterKey.totalFollowing(actorId),
            1,
            currentTime
          ),
          increaseCounterValue(
            trx,
            CounterKey.totalFollowers(targetActorId),
            1,
            currentTime
          )
        ])
      }
    })
    return follow
  },

  async updateFollowPreferences({
    actorId,
    targetActorId,
    reblogs,
    notify,
    languages
  }: UpdateFollowPreferencesParams) {
    const existingFollow = await this.getAcceptedOrRequestedFollow({
      actorId,
      targetActorId
    })
    if (!existingFollow) return null

    // Only persist the preferences the caller actually provided so an update
    // never clobbers fields the client did not mention.
    const updates: Record<string, unknown> = {}
    if (reblogs !== undefined) updates.reblogs = reblogs
    if (notify !== undefined) updates.notify = notify
    if (languages !== undefined) {
      // An explicit empty list clears the filter (stored as null).
      updates.languages =
        languages && languages.length > 0 ? JSON.stringify(languages) : null
    }

    if (Object.keys(updates).length === 0) return existingFollow

    const currentTime = new Date()
    updates.updatedAt = currentTime
    await database('follows').where('id', existingFollow.id).update(updates)

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
  },

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    const data = await database('follows').where('id', followId).first()
    if (!data) return null
    return fixFollowDataDate(data)
  },

  async getLocalFollowersForActorId({
    targetActorId
  }: GetLocalFollowersForActorIdParams) {
    const actor = await actorDatabase.getActorFromId({ id: targetActorId })
    // External actor, all followers are internal
    if (!actor?.privateKey) {
      const follows = await database('follows')
        .where('targetActorId', targetActorId)
        .whereIn('status', [FollowStatus.enum.Accepted])
        .orderBy('createdAt', 'desc')

      return follows.map(fixFollowDataDate)
    }

    const domains = (
      await database('actors')
        .whereNotNull('privateKey')
        .select('domain')
        .distinct()
    ).map((item) => item.domain)
    const follows = database('follows')
      .where('targetActorId', targetActorId)
      .whereIn('actorHost', domains)
      .whereIn('status', [FollowStatus.enum.Accepted])
      .orderBy('createdAt', 'desc')
    return (await follows).map(fixFollowDataDate)
  },

  async getLocalFollowsFromInboxUrl({
    targetActorId,
    followerInboxUrl
  }: GetLocalFollowsFromInboxUrlParams) {
    const [followsFromInbox, followsFromSharedInbox] = await Promise.all([
      database<Follow>('follows')
        .where('targetActorId', targetActorId)
        .where('inbox', followerInboxUrl),
      database<Follow>('follows')
        .where('targetActorId', targetActorId)
        .where('sharedInbox', followerInboxUrl)
    ])
    const uniqueFollows: Record<string, Follow> = {}
    for (const follow of [...followsFromInbox, ...followsFromSharedInbox]) {
      uniqueFollows[follow.id] = follow
    }

    return Object.values(uniqueFollows).map(fixFollowDataDate)
  },

  async getLocalActorsFromFollowerUrl({
    followerUrl
  }: GetLocalActorsFromFollowerUrlParams) {
    const actor = await database('actors')
      .whereJsonPath('settings', '$.followersUrl', '=', followerUrl)
      .select('id')
      .first()
    if (!actor?.id) return []

    return database.transaction(async (trx) => {
      const localActors = await trx('actors')
        .leftJoin('follows', 'follows.actorId', 'actors.id')
        .where('follows.targetActorId', actor.id)
        .where('follows.status', FollowStatus.enum.Accepted)
        .where('actors.privateKey', '<>', '')
        .select('actors.*')
      return Promise.all(
        localActors.map(async (actor) => {
          const [account, counters, lastStatus] = await Promise.all([
            trx<Account>('accounts').where('id', actor.accountId).first(),
            getCounterValues(trx, [
              CounterKey.totalFollowers(actor.id),
              CounterKey.totalFollowing(actor.id),
              CounterKey.totalStatus(actor.id)
            ]),
            trx('statuses')
              .where('actorId', actor.id)
              .orderBy('createdAt', 'desc')
              .first<{ createdAt: number | Date }>('createdAt')
          ])
          const lastStatusCreatedAt = lastStatus?.createdAt
            ? lastStatus.createdAt
            : 0
          return actorDatabase.getActor(
            actor,
            counters[CounterKey.totalFollowing(actor.id)] ?? 0,
            counters[CounterKey.totalFollowers(actor.id)] ?? 0,
            counters[CounterKey.totalStatus(actor.id)] ?? 0,
            typeof lastStatusCreatedAt === 'number'
              ? lastStatusCreatedAt
              : lastStatusCreatedAt.getTime(),
            account
          )
        })
      )
    })
  },

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams) {
    const follow = await database<Follow>('follows')
      .where({
        actorId,
        targetActorId
      })
      .whereIn('status', [
        FollowStatus.enum.Accepted,
        FollowStatus.enum.Requested
      ])
      .first()
    if (!follow) return null
    return fixFollowDataDate(follow)
  },

  async getAcceptedFollowTargetActorIds({
    actorId,
    targetActorIds
  }: GetAcceptedFollowTargetActorIdsParams) {
    const uniqueTargetActorIds = [...new Set(targetActorIds)]
    if (uniqueTargetActorIds.length === 0) return []

    const follows = await database<Pick<Follow, 'targetActorId'>>('follows')
      .select('targetActorId')
      .where({
        actorId,
        status: FollowStatus.enum.Accepted
      })
      .whereIn('targetActorId', uniqueTargetActorIds)
    return [...new Set(follows.map((follow) => follow.targetActorId))]
  },

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    const follows = await database<Follow>('follows')
      .select(['inbox', 'sharedInbox'])
      .where({
        targetActorId,
        status: FollowStatus.enum.Accepted
      })
    const inboxes = Array.from(
      follows.reduce((uniqueInboxes, follow) => {
        if (follow.sharedInbox) uniqueInboxes.add(follow.sharedInbox)
        else uniqueInboxes.add(follow.inbox)
        return uniqueInboxes
      }, new Set<string>())
    )
    return inboxes
  },

  async updateFollowStatus({ followId, status }: UpdateFollowStatusParams) {
    const currentTime = new Date()
    await database.transaction(async (trx) => {
      const existingFollow = await trx('follows')
        .where('id', followId)
        .first<Follow>()
      if (!existingFollow) return

      await trx('follows').where('id', followId).update({
        status,
        updatedAt: currentTime
      })

      const wasAccepted = existingFollow.status === FollowStatus.enum.Accepted
      const isAccepted = status === FollowStatus.enum.Accepted

      if (!wasAccepted && isAccepted) {
        await Promise.all([
          increaseCounterValue(
            trx,
            CounterKey.totalFollowing(existingFollow.actorId),
            1,
            currentTime
          ),
          increaseCounterValue(
            trx,
            CounterKey.totalFollowers(existingFollow.targetActorId),
            1,
            currentTime
          )
        ])
      }

      if (wasAccepted && !isAccepted) {
        await Promise.all([
          decreaseCounterValue(
            trx,
            CounterKey.totalFollowing(existingFollow.actorId),
            1,
            currentTime
          ),
          decreaseCounterValue(
            trx,
            CounterKey.totalFollowers(existingFollow.targetActorId),
            1,
            currentTime
          )
        ])
      }

      // Mastodon ties list membership to the follow: unfollowing an account
      // removes it from all of the unfollower's lists. List membership is the
      // source of truth for the list timeline, so dropping the membership (and
      // the materialized list-feed rows it produced) is all that's needed — the
      // owner is existingFollow.actorId (the follower) and the member is
      // existingFollow.targetActorId (the followed). A user has few lists, so
      // this is a small indexed delete on a rare action.
      if (status === FollowStatus.enum.Undo) {
        const ownerId = existingFollow.actorId
        const memberId = existingFollow.targetActorId
        const memberships = await trx('list_accounts')
          .where({ actorId: ownerId, targetActorId: memberId })
          .select('listId')
        if (memberships.length > 0) {
          await trx('list_accounts')
            .where({ actorId: ownerId, targetActorId: memberId })
            .delete()
          await trx('timelines')
            .where('actorId', ownerId)
            .where('statusActorId', memberId)
            .whereIn(
              'timeline',
              memberships.map((row) => listTimelineKey(row.listId as string))
            )
            .delete()
        }
      }
    })
  },

  // New method to get the follows with pagination
  async getFollowing({
    actorId,
    limit,
    maxId,
    minId,
    sinceId
  }: GetFollowingParams) {
    const query = database('follows')
      .where('actorId', actorId)
      .andWhere('status', FollowStatus.enum.Accepted)
      .limit(limit)

    if (maxId) query.where('id', '<', maxId)
    if (minId) query.where('id', '>', minId)
    if (sinceId) query.where('id', '>', sinceId)

    // min_id returns the OLDEST band immediately after the cursor (ascending),
    // presented newest-first; max_id/since_id/none return the newest band.
    if (minId) {
      const follows = await query.orderBy('id', 'asc')
      return follows.reverse().map(fixFollowDataDate)
    }
    const follows = await query.orderBy('id', 'desc')
    return follows.map(fixFollowDataDate)
  },

  async getFollowers({
    targetActorId,
    limit,
    maxId,
    minId,
    sinceId
  }: GetFollowersParams) {
    const query = database('follows')
      .where('targetActorId', targetActorId)
      .andWhere('status', FollowStatus.enum.Accepted)
      .limit(limit)

    if (maxId) query.where('id', '<', maxId)
    if (minId) query.where('id', '>', minId)
    if (sinceId) query.where('id', '>', sinceId)

    // min_id returns the OLDEST band immediately after the cursor (ascending),
    // presented newest-first; max_id/since_id/none return the newest band.
    if (minId) {
      const follows = await query.orderBy('id', 'asc')
      return follows.reverse().map(fixFollowDataDate)
    }
    const follows = await query.orderBy('id', 'desc')
    return follows.map(fixFollowDataDate)
  },

  async getFollowRequests({
    targetActorId,
    limit,
    maxId,
    minId,
    sinceId
  }: GetFollowRequestsParams) {
    // Cursor pagination on (createdAt, id): follow ids are random UUIDs, so the
    // createdAt-first ordering (with id as a stable tiebreaker) is what makes the
    // page genuinely newest-first. Mirrors getBlocks/getMutes.
    const query = database('follows')
      .where('targetActorId', targetActorId)
      .andWhere('status', FollowStatus.enum.Requested)
      .limit(limit)

    const cursorId = maxId || minId || sinceId

    if (cursorId) {
      // Look up the cursor row by owner + id only (mirroring getBlocks'
      // `{ actorId, id }`). The status is deliberately NOT filtered here: the
      // cursor only supplies a (createdAt, id) keyset boundary, so pagination
      // must stay correct even if the boundary request was authorized/rejected
      // between page fetches. The main query above still returns Requested rows
      // only, so no non-pending rows leak into the results.
      const cursor = await database('follows')
        .where({
          targetActorId,
          id: cursorId
        })
        .first()
      if (!cursor) return []
      applyFollowCursor(query, cursor, maxId ? 'older' : 'newer')
    }

    if (minId) {
      query.orderBy('createdAt', 'asc').orderBy('id', 'asc')
    } else {
      query.orderBy('createdAt', 'desc').orderBy('id', 'desc')
    }

    const follows = await query
    return (minId ? follows.reverse() : follows).map(fixFollowDataDate)
  },

  async getFollowRequestsCount({
    targetActorId
  }: GetFollowRequestsCountParams) {
    const result = await database('follows')
      .where('targetActorId', targetActorId)
      .andWhere('status', FollowStatus.enum.Requested)
      .count<{ count: string }>('* as count')
      .first()
    return parseInt(result?.count ?? '0', 10)
  }
})
