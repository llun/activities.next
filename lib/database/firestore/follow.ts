import { Firestore } from '@google-cloud/firestore'

import { getCompatibleTime } from '@/lib/database/firestore/utils'
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
} from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { Follow } from '@/lib/types/domain/follow'

export const FollowerFirestoreDatabaseMixin = (
  database: Firestore,
  _actorDatabase: any // Using any to avoid circular dependency issues in types for now
): FollowDatabase => ({
  async createFollow(params: CreateFollowParams): Promise<Follow> {
    const followId = crypto.randomUUID()
    const currentTime = new Date()
    const data = {
      id: followId,
      actorId: params.actorId,
      targetActorId: params.targetActorId,
      status: params.status,
      inbox: params.inbox,
      sharedInbox: params.sharedInbox,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database.collection('follows').doc(followId).set(data)
    const follow = await this.getFollowFromId({ followId })
    if (!follow) throw new Error('Failed to create follow')
    return follow
  },

  async getFollowFromId({
    followId
  }: GetFollowFromIdParams): Promise<Follow | null> {
    const doc = await database.collection('follows').doc(followId).get()
    if (!doc.exists) return null
    const data = doc.data() as any
    return Follow.parse({
      ...data,
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async getLocalFollowersForActorId({
    targetActorId
  }: GetLocalFollowersForActorIdParams): Promise<Follow[]> {
    const result = await database
      .collection('follows')
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', 'Accepted')
      .get()
    return result.docs.map((doc) => {
      const data = doc.data() as any
      return Follow.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  },

  async getLocalFollowsFromInboxUrl({
    targetActorId,
    followerInboxUrl
  }: GetLocalFollowsFromInboxUrlParams): Promise<Follow[]> {
    const result = await database
      .collection('follows')
      .where('targetActorId', '==', targetActorId)
      .where('inbox', '==', followerInboxUrl)
      .get()
    return result.docs.map((doc) => {
      const data = doc.data() as any
      return Follow.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  },

  async getLocalActorsFromFollowerUrl({
    followerUrl
  }: GetLocalActorsFromFollowerUrlParams): Promise<Actor[]> {
    const result = await database
      .collection('actors')
      .where('followersUrl', '==', followerUrl)
      .get()
    const actors = await Promise.all(
      result.docs.map((doc) =>
        _actorDatabase.getActorFromId({ id: doc.data().id })
      )
    )
    return actors.filter((actor): actor is Actor => actor !== null)
  },

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams): Promise<Follow | null> {
    const result = await database
      .collection('follows')
      .where('actorId', '==', actorId)
      .where('targetActorId', '==', targetActorId)
      .where('status', 'in', ['Accepted', 'Requested'])
      .limit(1)
      .get()
    if (result.empty) return null
    const data = result.docs[0].data() as any
    return Follow.parse({
      ...data,
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async getFollowersInbox({
    targetActorId
  }: GetFollowersInboxParams): Promise<string[]> {
    const follows = await this.getLocalFollowersForActorId({ targetActorId })
    const inboxes = new Set<string>()
    for (const follow of follows) {
      inboxes.add(follow.sharedInbox || follow.inbox)
    }
    return Array.from(inboxes)
  },

  async updateFollowStatus({
    followId,
    status
  }: UpdateFollowStatusParams): Promise<void> {
    await database.collection('follows').doc(followId).update({
      status,
      updatedAt: new Date()
    })
  },

  async getFollowing({
    actorId,
    limit,
    maxId,
    minId
  }: GetFollowingParams): Promise<Follow[]> {
    let query = database
      .collection('follows')
      .where('actorId', '==', actorId)
      .where('status', '==', 'Accepted')
      .orderBy('id', 'desc')
      .limit(limit)

    if (maxId) {
      query = query.startAfter(maxId)
    }
    if (minId) {
      query = query.endBefore(minId)
    }

    const result = await query.get()
    return result.docs.map((doc) => {
      const data = doc.data() as any
      return Follow.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  },

  async getFollowers({
    targetActorId,
    limit,
    maxId,
    minId
  }: GetFollowersParams): Promise<Follow[]> {
    let query = database
      .collection('follows')
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', 'Accepted')
      .orderBy('id', 'desc')
      .limit(limit)

    if (maxId) {
      query = query.startAfter(maxId)
    }
    if (minId) {
      query = query.endBefore(minId)
    }

    const result = await query.get()
    return result.docs.map((doc) => {
      const data = doc.data() as any
      return Follow.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  },

  async getFollowRequests({
    targetActorId,
    limit,
    offset
  }: GetFollowRequestsParams): Promise<Follow[]> {
    let query = database
      .collection('follows')
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', 'Requested')
      .orderBy('createdAt', 'desc')
      .limit(limit)

    if (offset) {
      // Firestore doesn't have offset in the same way, we'd use startAfter.
      // But for simplicity in this implementation:
      query = query.offset(offset)
    }

    const result = await query.get()
    return result.docs.map((doc) => {
      const data = doc.data() as any
      return Follow.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    })
  },

  async getFollowRequestsCount({
    targetActorId
  }: GetFollowRequestsCountParams): Promise<number> {
    const result = await database
      .collection('follows')
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', 'Requested')
      .count()
      .get()
    return result.data().count
  }
})
