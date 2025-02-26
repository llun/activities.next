import { Firestore } from '@google-cloud/firestore'
import { Mastodon } from '@llun/activities.schema'

import { urlToId } from '@/lib/database/firestore/urlToId'
import { AccountDatabase } from '@/lib/database/types/account'
import {
  ActorDatabase,
  CreateActorParams,
  DeleteActorParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  IsCurrentActorFollowingParams,
  IsInternalActorParams,
  UpdateActorParams
} from '@/lib/database/types/actor'
import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'
import { FollowStatus } from '@/lib/models/follow'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const ActorFirestoreDatabaseMixin = (
  firestore: Firestore,
  accountDatabase: AccountDatabase
): ActorDatabase => {
  function getActorFromDataAndAccount(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    account?: Account | null
  ): Actor {
    return Actor.parse({
      id: data.id,
      username: data.username,
      domain: data.domain,
      followersUrl: data.followersUrl,
      inboxUrl: data.inboxUrl,
      sharedInboxUrl: data.sharedInboxUrl,
      ...(data.name ? { name: data.name } : null),
      ...(data.summary ? { summary: data.summary } : null),
      ...(data.iconUrl ? { iconUrl: data.iconUrl } : null),
      ...(data.headerImageUrl ? { headerImageUrl: data.headerImageUrl } : null),
      ...(data.appleSharedAlbumToken
        ? { appleSharedAlbumToken: data.appleSharedAlbumToken }
        : null),
      followingCount: data.followingCount ?? 0,
      followersCount: data.followersCount ?? 0,
      publicKey: data.publicKey,
      ...(data.privateKey ? { privateKey: data.privateKey } : null),
      ...(account ? { account } : null),

      statusCount: data.statusCount ?? 0,
      lastStatusAt: data.lastStatusAt ?? 0,

      createdAt: Number.isNaN(data.createdAt) ? 0 : data.createdAt,
      updatedAt: Number.isNaN(data.updatedAt) ? 0 : data.updatedAt
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getMastodonActorFromData(data: any): Mastodon.Account {
    return Mastodon.Account.parse({
      id: encodeURIComponent(data.id),
      username: data.username,
      acct: `${data.username}@${data.domain}`,
      url: data.id,
      display_name: data.name ?? '',
      note: data.summary ?? '',
      avatar: data.iconUrl ?? '',
      avatar_static: data.iconUrl ?? '',
      header: data.headerImageUrl ?? '',
      header_static: data.headerImageUrl ?? '',

      fields: [],
      emojis: [],

      locked: false,
      bot: false,
      group: false,
      discoverable: true,
      noindex: false,

      source: {
        note: '',
        fields: [],
        privacy: 'public',
        sensitive: false,
        language: 'en',
        follow_requests_count: 0
      },

      created_at: getISOTimeUTC(data.createdAt),
      last_status_at: data.lastStatusAt
        ? getISOTimeUTC(data.lastStatusAt)
        : null,

      followers_count: data.followersCount ?? 0,
      following_count: data.followingCount ?? 0,
      statuses_count: data.statusCount ?? 0
    })
  }

  return {
    async createActor({
      actorId,

      username,
      domain,
      name = '',
      summary = '',
      iconUrl = '',
      headerImageUrl = '',
      followersUrl,
      inboxUrl,
      sharedInboxUrl,

      publicKey,
      privateKey = '',

      createdAt
    }: CreateActorParams) {
      const currentTime = Date.now()
      const doc = {
        id: actorId,
        username,
        name,
        summary,
        iconUrl,
        headerImageUrl,
        followersUrl,
        inboxUrl,
        sharedInboxUrl,
        domain,
        publicKey,
        privateKey,

        followingCount: 0,
        followersCount: 0,
        statusCount: 0,

        createdAt,
        updatedAt: currentTime
      }
      await firestore.doc(`actors/${urlToId(actorId)}`).set(doc)
      return this.getActorFromId({ id: actorId })
    },

    async createMastodonActor({
      actorId,

      username,
      domain,
      name = '',
      summary = '',
      iconUrl = '',
      headerImageUrl = '',
      followersUrl,
      inboxUrl,
      sharedInboxUrl,

      publicKey,
      privateKey = '',

      createdAt
    }: CreateActorParams): Promise<Mastodon.Account | null> {
      const currentTime = Date.now()
      const doc = {
        id: actorId,
        username,
        name,
        summary,
        iconUrl,
        headerImageUrl,
        followersUrl,
        inboxUrl,
        sharedInboxUrl,
        domain,
        publicKey,
        privateKey,

        followingCount: 0,
        followersCount: 0,
        statusCount: 0,

        createdAt,
        updatedAt: currentTime
      }
      const docRef = firestore.doc(`actors/${urlToId(actorId)}`)
      const persistedDoc = await docRef.get()
      if (persistedDoc.exists) {
        return null
      }

      await docRef.set(doc)
      return getMastodonActorFromData(doc)
    },

    async getActorFromEmail({ email }: GetActorFromEmailParams) {
      const accounts = firestore.collection('accounts')
      const accountsSnapshot = await accounts
        .where('email', '==', email)
        .limit(1)
        .get()
      if (accountsSnapshot.docs.length !== 1) return

      const accountId = accountsSnapshot.docs[0].id
      const actors = firestore.collection('actors')
      const actorsSnapshot = await actors
        .where('accountId', '==', accountId)
        .limit(1)
        .get()
      if (actorsSnapshot.docs.length !== 1) return

      const data = actorsSnapshot.docs[0].data()
      const account = {
        ...accountsSnapshot.docs[0].data(),
        id: accountId
      } as Account
      return getActorFromDataAndAccount(data, account)
    },

    async getMastodonActorFromEmail({ email }: GetActorFromEmailParams) {
      const accounts = firestore.collection('accounts')
      const accountsSnapshot = await accounts
        .where('email', '==', email)
        .limit(1)
        .get()
      if (accountsSnapshot.docs.length !== 1) return null

      const accountId = accountsSnapshot.docs[0].id
      const actors = firestore.collection('actors')
      const actorsSnapshot = await actors
        .where('accountId', '==', accountId)
        .limit(1)
        .get()
      if (actorsSnapshot.docs.length !== 1) return null

      const data = actorsSnapshot.docs[0].data()
      return getMastodonActorFromData(data)
    },

    async getActorFromUsername({
      username,
      domain
    }: GetActorFromUsernameParams) {
      const actors = firestore.collection('actors')
      const snapshot = await actors
        .where('username', '==', username)
        .where('domain', '==', domain)
        .limit(1)
        .get()
      if (snapshot.docs.length !== 1) return
      const data = snapshot.docs[0].data()
      if (!data.accountId) {
        return getActorFromDataAndAccount(data)
      }

      const account = await accountDatabase.getAccountFromId({
        id: data.accountId
      })
      return getActorFromDataAndAccount(data, account)
    },

    async getMastodonActorFromUsername({
      username,
      domain
    }: GetActorFromUsernameParams) {
      const actors = firestore.collection('actors')
      const snapshot = await actors
        .where('username', '==', username)
        .where('domain', '==', domain)
        .limit(1)
        .get()
      if (snapshot.docs.length !== 1) return null
      const data = snapshot.docs[0].data()
      return getMastodonActorFromData(data)
    },

    async getActorFromId({ id }: GetActorFromIdParams) {
      const doc = await firestore.doc(`actors/${urlToId(id)}`).get()
      const data = doc.data()
      if (!data) return

      if (!data.accountId) {
        return getActorFromDataAndAccount(data)
      }

      const account = await accountDatabase.getAccountFromId({
        id: data.accountId
      })
      return getActorFromDataAndAccount(data, account)
    },

    async getMastodonActorFromId({ id }: GetActorFromIdParams) {
      const doc = await firestore.doc(`actors/${urlToId(id)}`).get()
      const data = doc.data()
      if (!data) return null

      return getMastodonActorFromData(data)
    },

    async updateActor({
      actorId,
      name,
      summary,
      iconUrl,
      headerImageUrl,
      appleSharedAlbumToken,

      publicKey,

      followersUrl,
      inboxUrl,
      sharedInboxUrl
    }: UpdateActorParams) {
      const path = `actors/${urlToId(actorId)}`
      const doc = await firestore.doc(path).get()
      if (!doc.exists) return

      const currentTime = Date.now()
      const data = doc.data()
      await firestore.doc(path).update({
        ...data,
        ...(iconUrl ? { iconUrl } : null),
        ...(headerImageUrl ? { headerImageUrl } : null),
        ...(appleSharedAlbumToken ? { appleSharedAlbumToken } : null),
        ...(name ? { name } : null),
        ...(summary ? { summary } : null),
        ...(publicKey ? { publicKey } : null),
        ...(followersUrl ? { followersUrl } : null),
        ...(inboxUrl ? { inboxUrl } : null),
        ...(sharedInboxUrl ? { sharedInboxUrl } : null),
        updatedAt: currentTime
      })
      return this.getActorFromId({ id: actorId })
    },

    async deleteActor({ actorId }: DeleteActorParams): Promise<void> {
      const actors = firestore.collection('actors')
      const snapshot = await actors.where('id', '==', actorId).get()
      await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
    },

    async isCurrentActorFollowing({
      currentActorId,
      followingActorId
    }: IsCurrentActorFollowingParams) {
      const follows = firestore.collection('follows')
      const snapshot = await follows
        .where('actorId', '==', currentActorId)
        .where('targetActorId', '==', followingActorId)
        .where('status', '==', FollowStatus.enum.Accepted)
        .count()
        .get()
      return snapshot.data().count > 0
    },

    async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
      const follows = firestore.collection('follows')
      const snapshot = await follows
        .where('actorId', '==', actorId)
        .where('status', '==', FollowStatus.enum.Accepted)
        .count()
        .get()
      return snapshot.data().count
    },

    async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
      const follows = firestore.collection('follows')
      const snapshot = await follows
        .where('targetActorId', '==', actorId)
        .where('status', '==', FollowStatus.enum.Accepted)
        .count()
        .get()
      return snapshot.data().count
    },

    async isInternalActor({ actorId }: IsInternalActorParams) {
      const actorDoc = await firestore.doc(`actors/${urlToId(actorId)}`).get()
      if (!actorDoc.exists) return false
      return Boolean(actorDoc?.data()?.accountId)
    }
  }
}
