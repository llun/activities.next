import { Knex } from 'knex'

import { SQLActorDatabase } from '@/lib/database/sql/actor'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateFollowParams,
  FollowDatabase,
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
  UpdateFollowStatusParams
} from '@/lib/database/types/follow'
import { Account } from '@/lib/models/account'
import { Follow, FollowStatus } from '@/lib/models/follow'

const fixFollowDataDate = (data: Follow): Follow => ({
  ...data,
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
    sharedInbox
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
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
    await database('follows').insert({
      ...follow,
      inbox,
      sharedInbox,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return follow
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
          const [
            account,
            totalFollowers,
            totalFollowing,
            totalStatus,
            lastStatus
          ] = await Promise.all([
            trx<Account>('accounts').where('id', actor.accountId).first(),
            trx('follows')
              .where('targetActorId', actor.id)
              .andWhere('status', 'Accepted')
              .count<{ count: string }>('* as count')
              .first(),
            trx('follows')
              .where('actorId', actor.id)
              .andWhere('status', 'Accepted')
              .count<{ count: string }>('* as count')
              .first(),
            trx('statuses')
              .where('actorId', actor.id)
              .count<{ count: string }>('id as count')
              .first(),
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
            parseInt(totalFollowing?.count ?? '0', 10),
            parseInt(totalFollowers?.count ?? '0', 10),
            parseInt(totalStatus?.count ?? '0', 10),
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
    await database('follows').where('id', followId).update({
      status,
      updatedAt: new Date()
    })
  },

  // New method to get the follows with pagination
  async getFollowing({ actorId, limit, maxId, minId }: GetFollowingParams) {
    const query = database('follows')
      .where('actorId', actorId)
      .andWhere('status', FollowStatus.enum.Accepted)
      .orderBy('id', 'desc')
      .limit(limit)

    if (maxId) {
      query.where('id', '<', maxId)
    }

    if (minId) {
      query.where('id', '>', minId)
    }

    const follows = await query

    // If using minId, we need to reverse the results to maintain chronological order
    const orderedFollows = minId ? [...follows].reverse() : follows

    return orderedFollows.map(fixFollowDataDate)
  },

  async getFollowers({
    targetActorId,
    limit,
    maxId,
    minId
  }: GetFollowersParams) {
    const query = database('follows')
      .where('targetActorId', targetActorId)
      .andWhere('status', FollowStatus.enum.Accepted)
      .orderBy('id', 'desc')
      .limit(limit)

    if (maxId) {
      query.where('id', '<', maxId)
    }

    if (minId) {
      query.where('id', '>', minId)
    }

    const follows = await query

    // If using minId, we need to reverse the results to maintain chronological order
    const orderedFollows = minId ? [...follows].reverse() : follows

    return orderedFollows.map(fixFollowDataDate)
  },

  async getFollowRequests({
    targetActorId,
    limit,
    offset = 0
  }: GetFollowRequestsParams) {
    const follows = await database('follows')
      .where('targetActorId', targetActorId)
      .andWhere('status', FollowStatus.enum.Requested)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset)

    return follows.map(fixFollowDataDate)
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
