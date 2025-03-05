import { FieldValue, Firestore } from '@google-cloud/firestore'

import { ActorDatabase } from '@/lib/database/types/actor'
import {
  CreateFollowParams,
  FollowDatabase,
  GetAcceptedOrRequestedFollowParams,
  GetFollowFromIdParams,
  GetFollowersInboxParams,
  GetFollowingParams,
  GetLocalActorsFromFollowerUrlParams,
  GetLocalFollowersForActorIdParams,
  GetLocalFollowsFromInboxUrlParams,
  UpdateFollowStatusParams
} from '@/lib/database/types/follow'
import { Actor } from '@/lib/models/actor'
import { Follow, FollowStatus } from '@/lib/models/follow'
import { urlToId } from '@/lib/utils/urlToId'

export const FollowerFirestoreDatabaseMixin = (
  firestore: Firestore,
  actorDatabase: ActorDatabase
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
    const content = {
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
    const follows = firestore.collection('follows')
    const ref = await follows.add(content)

    if (status === FollowStatus.enum.Accepted) {
      const actorRef = firestore.doc(`actors/${urlToId(actorId)}`)
      const targetActorRef = firestore.doc(`actors/${urlToId(targetActorId)}`)
      const [actor, targetActor] = await Promise.all([
        actorRef.get(),
        targetActorRef.get()
      ])
      await Promise.all([
        actor.exists &&
          actorRef.update({
            followingCount: FieldValue.increment(1)
          }),
        targetActor.exists &&
          targetActorRef.update({
            followersCount: FieldValue.increment(1)
          })
      ])
    }

    return {
      id: ref.id,
      ...content
    }
  },

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    const follows = firestore.collection('follows')
    const snapshot = await follows.doc(followId).get()
    if (!snapshot) return null

    const data = snapshot.data()
    return Follow.parse({
      id: followId,
      actorHost: new URL(data?.actorId).host,
      targetActorHost: new URL(data?.targetActorId).host,
      ...data
    })
  },

  async getLocalFollowersForActorId({
    targetActorId
  }: GetLocalFollowersForActorIdParams) {
    const actor = await actorDatabase.getActorFromId({ id: targetActorId })
    // External actor, all followers are internal
    if (!actor?.privateKey) {
      const follows = firestore.collection('follows')
      const snapshot = await follows
        .where('targetActorId', '==', targetActorId)
        .where('status', '==', FollowStatus.enum.Accepted)
        .get()
      return snapshot.docs.map((doc) =>
        Follow.parse({ id: doc.id, ...doc.data() })
      )
    }

    // Internal actor, returns only local followers
    const localActors = await firestore
      .collection('actors')
      .where('privateKey', '!=', '')
      .get()
    const domains = Array.from(
      new Set(localActors.docs.map((doc) => doc.data().domain))
    )

    const follows = firestore.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', FollowStatus.enum.Accepted)
      .where('actorHost', 'in', domains)
      .get()
    return snapshot.docs.map((doc) =>
      Follow.parse({ id: doc.id, ...doc.data() })
    )
  },

  async getLocalActorsFromFollowerUrl({
    followerUrl
  }: GetLocalActorsFromFollowerUrlParams) {
    const actorFromFollowerUrl = await firestore
      .collection('actors')
      .where('followersUrl', '==', followerUrl)
      .get()
    if (!actorFromFollowerUrl.size) return []
    const id = actorFromFollowerUrl.docs[0].data().id

    const follows = await firestore
      .collection('follows')
      .where('targetActorId', '==', id)
      .where('status', '==', FollowStatus.enum.Accepted)
      .get()
    if (!follows.size) return []
    const followers = follows.docs
      .map((doc) => doc.data())
      .map((data) => data.actorId)

    const actors = (
      await Promise.all(
        followers.map((actorId) =>
          actorDatabase.getActorFromId({ id: actorId })
        )
      )
    ).filter(
      (actor): actor is Actor => actor !== undefined && !!actor.privateKey
    )
    return actors
  },

  async getLocalFollowsFromInboxUrl({
    targetActorId,
    followerInboxUrl
  }: GetLocalFollowsFromInboxUrlParams) {
    const [followsFromInboxSnapshot, followsFromSharedInboxSnapshot] =
      await Promise.all([
        firestore
          .collection('follows')
          .where('targetActorId', '==', targetActorId)
          .where('inbox', '==', followerInboxUrl)
          .get(),
        firestore
          .collection('follows')
          .where('targetActorId', '==', targetActorId)
          .where('sharedInbox', '==', followerInboxUrl)
          .get()
      ])
    const followsFromInboxData = followsFromInboxSnapshot.docs.map((doc) =>
      Follow.parse({ id: doc.id, ...doc.data() })
    )
    const followsFromSharedInboxData = followsFromSharedInboxSnapshot.docs.map(
      (doc) => Follow.parse({ id: doc.id, ...doc.data() })
    )
    const uniqueFollows: Record<string, Follow> = {}
    for (const follow of [
      ...followsFromInboxData,
      ...followsFromSharedInboxData
    ]) {
      uniqueFollows[follow.id] = follow
    }
    return Object.values(uniqueFollows)
  },

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams) {
    const follows = firestore.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', actorId)
      .where('targetActorId', '==', targetActorId)
      .where('status', 'in', [
        FollowStatus.enum.Accepted,
        FollowStatus.enum.Requested
      ])
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
    if (snapshot.docs.length !== 1) return null
    const document = snapshot.docs[0]
    const data = document.data()
    return Follow.parse({
      ...data,
      id: document.id,
      actorHost: new URL(data.actorId).host,
      targetActorHost: new URL(data.targetActorId).host
    })
  },

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    const follows = firestore.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', FollowStatus.enum.Accepted)
      .get()
    return Array.from(
      snapshot.docs.reduce((uniqueInboxes, document) => {
        const data = document.data()
        if (data.sharedInbox) uniqueInboxes.add(data.sharedInbox)
        else uniqueInboxes.add(data.inbox)
        return uniqueInboxes
      }, new Set<string>())
    )
  },

  async updateFollowStatus({ followId, status }: UpdateFollowStatusParams) {
    const follow = await this.getFollowFromId({ followId })
    if (!follow) return

    const actorRef = firestore.doc(`actors/${urlToId(follow.actorId)}`)
    const targetActorRef = firestore.doc(
      `actors/${urlToId(follow.targetActorId)}`
    )
    if (
      status === FollowStatus.enum.Accepted ||
      status === FollowStatus.enum.Undo
    ) {
      const [actor, targetActor] = await Promise.all([
        actorRef.get(),
        targetActorRef.get()
      ])
      await Promise.all([
        actor.exists
          ? actorRef.update({
              followingCount:
                status === FollowStatus.enum.Accepted
                  ? FieldValue.increment(1)
                  : FieldValue.increment(-1)
            })
          : Promise.resolve(),
        targetActor.exists
          ? targetActorRef.update({
              followersCount:
                status === FollowStatus.enum.Accepted
                  ? FieldValue.increment(1)
                  : FieldValue.increment(-1)
            })
          : null
      ])
    }

    const ref = firestore.collection('follows').doc(follow.id)
    await ref.update({
      status,
      updatedAt: Date.now()
    })
  },

  async getFollowing({
    actorId,
    limit,
    maxId,
    sinceId,
    minId
  }: GetFollowingParams) {
    const follows = firestore.collection('follows')
    let query = follows
      .where('actorId', '==', actorId)
      .where('status', '==', FollowStatus.enum.Accepted)
      .orderBy('id', 'desc')
      .limit(limit)

    if (maxId) {
      query = query.startAfter(maxId)
    }

    if (sinceId) {
      // In Firestore, we need to use two separate queries for this case
      const sinceDoc = await follows.doc(sinceId).get()
      if (sinceDoc.exists) {
        query = follows
          .where('actorId', '==', actorId)
          .where('status', '==', FollowStatus.enum.Accepted)
          .orderBy('id', 'asc')
          .startAfter(sinceDoc)
          .limit(limit)
      }
    }

    if (minId) {
      const minDoc = await follows.doc(minId).get()
      if (minDoc.exists) {
        query = follows
          .where('actorId', '==', actorId)
          .where('status', '==', FollowStatus.enum.Accepted)
          .orderBy('id', 'asc')
          .startAfter(minDoc)
          .limit(limit)
      }
    }

    const snapshot = await query.get()
    let results = snapshot.docs.map((doc) =>
      Follow.parse({ id: doc.id, ...doc.data() })
    )

    // If we used minId, we need to reverse the results to maintain chronological order
    if (minId) {
      results = results.reverse()
    }

    return results
  }
})
