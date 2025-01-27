import { Knex } from 'knex'

import { SQLActorDatabase } from '@/lib/database/sql/actor'
import {
  CreateFollowParams,
  FollowDatabase,
  GetAcceptedOrRequestedFollowParams,
  GetFollowFromIdParams,
  GetFollowersInboxParams,
  GetLocalActorsFromFollowerUrlParams,
  GetLocalFollowersForActorIdParams,
  GetLocalFollowsFromInboxUrlParams,
  UpdateFollowStatusParams
} from '@/lib/database/types/follow'
import { Account } from '@/lib/models/account'
import { Follow, FollowStatus } from '@/lib/models/follow'

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

    const currentTime = Date.now()
    const follow: Follow = {
      id: crypto.randomUUID(),
      actorId,
      actorHost: new URL(actorId).host,
      targetActorId,
      targetActorHost: new URL(targetActorId).host,
      status,
      inbox,
      sharedInbox,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database('follows').insert({ ...follow, inbox, sharedInbox })
    return follow
  },

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    return database<Follow>('follows').where('id', followId).first()
  },

  async getLocalFollowersForActorId({
    targetActorId
  }: GetLocalFollowersForActorIdParams) {
    const actor = await actorDatabase.getActorFromId({ id: targetActorId })
    // External actor, all followers are internal
    if (!actor?.privateKey) {
      return database<Follow>('follows')
        .where('targetActorId', targetActorId)
        .whereIn('status', [FollowStatus.enum.Accepted])
        .orderBy('createdAt', 'desc')
    }

    const domains = (
      await database('actors')
        .whereNotNull('privateKey')
        .select('domain')
        .distinct()
    ).map((item) => item.domain)

    return database<Follow>('follows')
      .where('targetActorId', targetActorId)
      .whereIn('actorHost', domains)
      .whereIn('status', [FollowStatus.enum.Accepted])
      .orderBy('createdAt', 'desc')
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

    return Object.values(uniqueFollows)
  },

  async getLocalActorsFromFollowerUrl({
    followerUrl
  }: GetLocalActorsFromFollowerUrlParams) {
    const actor = await database('actors')
      .jsonExtract('settings', '$.followersUrl', 'followersUrl')
      .where('followersUrl', followerUrl)
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
    return database<Follow>('follows')
      .where('actorId', actorId)
      .where('targetActorId', targetActorId)
      .whereIn('status', [
        FollowStatus.enum.Accepted,
        FollowStatus.enum.Requested
      ])
      .orderBy('createdAt', 'desc')
      .first()
  },

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    const follows = await database<Follow>('follows')
      .where('targetActorId', targetActorId)
      .where('status', FollowStatus.enum.Accepted)
    return Array.from(
      follows.reduce((inboxes, follow) => {
        if (follow.sharedInbox) inboxes.add(follow.sharedInbox)
        else inboxes.add(follow.inbox)
        return inboxes
      }, new Set<string>())
    )
  },

  async updateFollowStatus({ followId, status }: UpdateFollowStatusParams) {
    await database('follows').where('id', followId).update({
      status,
      updatedAt: Date.now()
    })
  }
})
