import { Firestore, Settings } from '@google-cloud/firestore'
import crypto from 'crypto'

import { PER_PAGE_LIMIT, deliverTo } from '.'
import { logger } from '../logger'
import { Account } from '../models/account'
import { Actor } from '../models/actor'
import { Attachment, AttachmentData } from '../models/attachment'
import { Follow, FollowStatus } from '../models/follow'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '../models/status'
import { Tag, TagData } from '../models/tag'
import { Timeline } from '../timelines/types'
import {
  CreateAccountParams,
  CreateActorParams,
  CreateAnnounceParams,
  CreateAttachmentParams,
  CreateFollowParams,
  CreateLikeParams,
  CreateNoteParams,
  CreateTagParams,
  CreateTimelineStatusParams,
  DeleteActorParams,
  DeleteLikeParams,
  DeleteStatusParams,
  GetAcceptedOrRequestedFollowParams,
  GetAccountFromIdParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetAttachmentsParams,
  GetFollowFromIdParams,
  GetFollowersInboxParams,
  GetLikeCountParams,
  GetLocalActorsFromFollowerUrlParams,
  GetLocalFollowersForActorIdParams,
  GetStatusParams,
  GetStatusesParams,
  GetTagsParams,
  GetTimelineParams,
  IsAccountExistsParams,
  IsCurrentActorFollowingParams,
  IsUsernameExistsParams,
  Storage,
  UpdateActorParams,
  UpdateFollowStatusParams
} from './types'

export interface FirebaseConfig extends Settings {
  type: 'firebase'
}

export class FirebaseStorage implements Storage {
  readonly db: Firestore

  constructor(config: FirebaseConfig) {
    if (process.env.FIREBASE_PRIVATE_KEY && config.credentials) {
      config.credentials.private_key = process.env.FIREBASE_PRIVATE_KEY
    }
    this.db = new Firestore(config)
  }

  async destroy() {
    await fetch(
      'http://127.0.0.1:8080/emulator/v1/projects/test/databases/(default)/documents',
      {
        method: 'DELETE'
      }
    )
    await this.db.terminate()
  }

  async isAccountExists({ email }: IsAccountExistsParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START isAccountExists')
    const accounts = this.db.collection('accounts')
    const snapshot = await accounts.where('email', '==', email).count().get()
    logger.debug('FIREBASE_END isAccountExists', Date.now() - start)
    return snapshot.data().count === 1
  }

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START isUsernameExists')
    const accounts = this.db.collection('actors')
    const snapshot = await accounts
      .where('username', '==', username)
      .where('domain', '==', domain)
      .count()
      .get()
    logger.debug('FIREBASE_END isUsernameExists', Date.now() - start)
    return snapshot.data().count === 1
  }

  async createAccount({
    email,
    username,
    domain,
    privateKey,
    publicKey
  }: CreateAccountParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START createAccount start')
    const actorId = `https://${domain}/users/${username}`
    if (await this.isAccountExists({ email })) {
      throw new Error('Account already exists')
    }

    const currentTime = Date.now()

    const accounts = this.db.collection('accounts')
    const accountRef = await accounts.add({
      email,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    await this.db.doc(`actors/${FirebaseStorage.urlToId(actorId)}`).set({
      id: actorId,
      accountId: accountRef.id,
      username,
      domain,
      followersUrl: `${actorId}/followers`,
      publicKey,
      privateKey,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    logger.debug('FIREBASE_END createAccount end', Date.now() - start)

    return accountRef.id
  }

  async getAccountFromId({ id }: GetAccountFromIdParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getAccountFromId')
    const accounts = this.db.collection('accounts')
    const snapshot = await accounts.doc(id).get()
    if (!snapshot) return
    logger.debug('FIREBASE_END getAccountFromId', Date.now() - start)
    return {
      ...snapshot.data(),
      id
    } as Account
  }

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
    const start = Date.now()
    logger.debug('FIREBASE_START createActor')
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
      createdAt,
      updatedAt: currentTime
    }
    await this.db.doc(`actors/${FirebaseStorage.urlToId(actorId)}`).set(doc)
    logger.debug('FIREBASE_END createActor', Date.now() - start)
    return this.getActorFromId({ id: actorId })
  }

  private getActorFromDataAndAccount(data: any, account?: Account): Actor {
    return new Actor({
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
      publicKey: data.publicKey,
      ...(data.privateKey ? { privateKey: data.privateKey } : null),
      ...(account ? { account } : null),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    })
  }

  async getActorFromEmail({ email }: GetActorFromEmailParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getActorFromEmail')
    const accounts = this.db.collection('accounts')
    const accountsSnapshot = await accounts
      .where('email', '==', email)
      .limit(1)
      .get()
    if (accountsSnapshot.docs.length !== 1) return

    const accountId = accountsSnapshot.docs[0].id
    const actors = this.db.collection('actors')
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

    logger.debug('FIREBASE_END getActorFromEmail', Date.now() - start)
    return this.getActorFromDataAndAccount(data, account)
  }

  async getActorFromUsername({ username, domain }: GetActorFromUsernameParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getActorFromUsername')
    const actors = this.db.collection('actors')
    const snapshot = await actors
      .where('username', '==', username)
      .where('domain', '==', domain)
      .limit(1)
      .get()
    if (snapshot.docs.length !== 1) return undefined

    const data = snapshot.docs[0].data()
    if (!data.accountId) {
      logger.debug('FIREBASE_END getActorFromUsername', Date.now() - start)
      return this.getActorFromDataAndAccount(data)
    }

    const account = await this.getAccountFromId({ id: data.accountId })
    logger.debug('FIREBASE_END getActorFromUsername', Date.now() - start)
    return this.getActorFromDataAndAccount(data, account)
  }

  static urlToId(idInURLFormat: string) {
    const url = new URL(idInURLFormat)
    return `${url.host}:${url.pathname.slice(1).replaceAll('/', ':')}`
  }

  async getActorFromId({ id }: GetActorFromIdParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getActorFromId')
    const doc = await this.db.doc(`actors/${FirebaseStorage.urlToId(id)}`).get()
    const data = doc.data()
    if (!data) {
      logger.debug('FIREBASE_END getActorFromId', Date.now() - start)
      return
    }

    if (!data.accountId) {
      logger.debug('FIREBASE_END getActorFromId', Date.now() - start)
      return this.getActorFromDataAndAccount(data)
    }

    const account = await this.getAccountFromId({ id: data.accountId })
    logger.debug('FIREBASE_END getActorFromId', Date.now() - start)
    return this.getActorFromDataAndAccount(data, account)
  }

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
    logger.debug('FIREBASE_START updateActor')

    const path = `actors/${FirebaseStorage.urlToId(actorId)}`
    const doc = await this.db.doc(path).get()
    if (!doc.exists) return

    const currentTime = Date.now()
    const data = doc.data()
    await this.db.doc(path).update({
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
    logger.debug('FIREBASE_END updateActor', Date.now() - currentTime)
    return this.getActorFromId({ id: actorId })
  }

  async deleteActor({ actorId }: DeleteActorParams): Promise<void> {
    const start = Date.now()
    logger.debug('FIREBASE_START deleteActor')
    const actors = this.db.collection('actors')
    const snapshot = await actors.where('id', '==', actorId).get()
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
    logger.debug('FIREBASE_END deleteActor', Date.now() - start)
  }

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START isCurrentActorFollowing')
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', currentActorId)
      .where('targetActorId', '==', followingActorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    logger.debug('FIREBASE_END isCurrentActorFollowing', Date.now() - start)
    return snapshot.data().count > 0
  }

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getActorFollowingCount')
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', actorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    logger.debug('FIREBASE_END getActorFollowingCount', Date.now() - start)
    return snapshot.data().count
  }

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getActorFollowersCount')
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', actorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    logger.debug('FIREBASE_END getActorFollowersCount', Date.now() - start)
    return snapshot.data().count
  }

  async createFollow({
    actorId,
    targetActorId,
    status,
    inbox,
    sharedInbox
  }: CreateFollowParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START createFollow')
    const existingFollow = await this.getAcceptedOrRequestedFollow({
      actorId,
      targetActorId
    })
    if (existingFollow) {
      logger.debug('FIREBASE_END createFollow', Date.now() - start)
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
    const follows = this.db.collection('follows')
    const ref = await follows.add(content)
    logger.debug('FIREBASE_END createFollow', Date.now() - start)
    return {
      id: ref.id,
      ...content
    }
  }

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getFollowFromId')
    const follows = this.db.collection('follows')
    const snapshot = await follows.doc(followId).get()
    if (!snapshot) return

    const data = snapshot.data()
    logger.debug('FIREBASE_END getFollowFromId', Date.now() - start)
    return {
      id: followId,
      actorHost: new URL(data?.actorId).host,
      targetActorHost: new URL(data?.targetActorId).host,
      ...data
    } as Follow
  }

  async getLocalFollowersForActorId({
    targetActorId
  }: GetLocalFollowersForActorIdParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getLocalFollowersForActorId')
    const actor = await this.getActorFromId({ id: targetActorId })
    // External actor, all followers are internal
    if (!actor?.privateKey) {
      const follows = this.db.collection('follows')
      const snapshot = await follows
        .where('targetActorId', '==', targetActorId)
        .where('status', '==', FollowStatus.Accepted)
        .get()

      logger.debug(
        'FIREBASE_END getLocalFollowersForActorId',
        Date.now() - start
      )
      return snapshot.docs.map((doc) => doc.data() as Follow)
    }

    // Internal actor, returns only local followers
    const localActors = await this.db
      .collection('actors')
      .where('privateKey', '!=', '')
      .get()
    const domains = Array.from(
      new Set(localActors.docs.map((doc) => doc.data().domain))
    )

    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', FollowStatus.Accepted)
      .where('actorHost', 'in', domains)
      .get()

    logger.debug('FIREBASE_END getLocalFollowersForActorId', Date.now() - start)
    return snapshot.docs.map((doc) => doc.data() as Follow)
  }

  async getLocalActorsFromFollowerUrl({
    followerUrl
  }: GetLocalActorsFromFollowerUrlParams) {
    const actorFromFollowerUrl = await this.db
      .collection('actors')
      .where('followersUrl', '==', followerUrl)
      .get()
    if (!actorFromFollowerUrl.size) return []
    const id = actorFromFollowerUrl.docs[0].data().id

    const follows = await this.db
      .collection('follows')
      .where('targetActorId', '==', id)
      .where('status', '==', FollowStatus.Accepted)
      .get()
    if (!follows.size) return []
    const followers = follows.docs
      .map((doc) => doc.data())
      .map((data) => data.actorId)

    const actors = (
      await Promise.all(
        followers.map((actorId) => this.getActorFromId({ id: actorId }))
      )
    ).filter(
      (actor): actor is Actor => actor !== undefined && actor.privateKey !== ''
    )

    return actors
  }

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getAcceptedOrRequestedFollow')
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', actorId)
      .where('targetActorId', '==', targetActorId)
      .where('status', 'in', [FollowStatus.Accepted, FollowStatus.Requested])
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
    if (snapshot.docs.length !== 1) return
    const document = snapshot.docs[0]
    const data = document.data()
    logger.debug(
      'FIREBASE_END getAcceptedOrRequestedFollow',
      Date.now() - start
    )
    return {
      ...data,
      id: document.id,
      actorHost: new URL(data.actorId).host,
      targetActorHost: new URL(data.targetActorId).host
    } as Follow
  }

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getFollowersInbox')
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', FollowStatus.Accepted)
      .get()
    logger.debug('FIREBASE_END getFollowersInbox', Date.now() - start)
    return Array.from(
      snapshot.docs.reduce((uniqueInboxes, document) => {
        const data = document.data()
        if (data.sharedInbox) uniqueInboxes.add(data.sharedInbox)
        else uniqueInboxes.add(data.inbox)
        return uniqueInboxes
      }, new Set<string>())
    )
  }

  async updateFollowStatus({ followId, status }: UpdateFollowStatusParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getFollowersInbox')
    const follow = await this.getFollowFromId({ followId })
    if (!follow) return

    const ref = this.db.collection('follows').doc(follow.id)
    await ref.update({
      status,
      updatedAt: Date.now()
    })
    logger.debug('FIREBASE_END getFollowersInbox', Date.now() - start)
  }

  private async getLocalActorFromReply(actorId?: string, reply?: string) {
    const start = Date.now()
    logger.debug('FIREBASE_START getLocalActorFromReply')
    if (actorId) {
      const actor = await this.getActorFromId({ id: actorId })
      logger.debug('FIREBASE_END getLocalActorFromReply', Date.now() - start)
      if (actor?.privateKey) return actorId
    }

    logger.debug('FIREBASE_END getLocalActorFromReply', Date.now() - start)
    if (!reply) return ''

    const localActors = await this.db
      .collection('actors')
      .where('privateKey', '!=', '')
      .get()
    const domains = localActors.docs.map((doc) => doc.data().domain)
    const url = new URL(reply)

    logger.debug('FIREBASE_END getLocalActorFromReply', Date.now() - start)
    if (!domains.includes(url.hostname)) return 'external'
    logger.debug('FIREBASE_END getLocalActorFromReply', Date.now() - start)
    return reply.slice(0, reply.indexOf('/statuses'))
  }

  async createNote({
    id,
    url,
    actorId,
    text,
    summary = '',
    to,
    cc,
    reply = '',
    createdAt
  }: CreateNoteParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START createNote')
    const currentTime = Date.now()
    const local = await deliverTo({ from: actorId, to, cc, storage: this })

    const status = {
      id,
      url,
      actorId,
      type: StatusType.Note,
      text,
      summary,
      to,
      cc,
      reply,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    } as StatusNote
    await this.db.doc(`statuses/${FirebaseStorage.urlToId(id)}`).set({
      ...status,
      localRecipients: local,
      localActorForReply: await this.getLocalActorFromReply(actorId, reply)
    })

    const actor = await this.getActorFromId({ id: actorId })
    logger.debug('FIREBASE_END createNote', Date.now() - start)
    return new Status({
      ...status,
      actor: actor?.toProfile() || null,
      attachments: [],
      totalLikes: 0,
      isActorLiked: false,
      isActorAnnounced: false,
      tags: [],
      replies: []
    })
  }

  async createAnnounce({
    id,
    actorId,
    to,
    cc,
    originalStatusId,
    createdAt
  }: CreateAnnounceParams): Promise<Status> {
    const start = Date.now()
    logger.debug('FIREBASE_START createAnnounce')
    const currentTime = Date.now()
    const local = await deliverTo({ from: actorId, to, cc, storage: this })
    const status = {
      id,
      actorId,
      type: StatusType.Announce,
      to,
      cc,
      originalStatusId,
      localRecipients: local,
      localActorForReply: await this.getLocalActorFromReply(actorId, ''),
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    } as any

    await this.db.doc(`statuses/${FirebaseStorage.urlToId(id)}`).set(status)

    const originalStatus = await this.getStatus({ statusId: originalStatusId })
    const announceData: StatusAnnounce = {
      ...status,
      originalStatus: originalStatus?.data
    }
    logger.debug('FIREBASE_END createAnnounce', Date.now() - start)
    return new Status(announceData)
  }

  private async isActorAnnouncedStatus(statusId: string, actorId?: string) {
    if (!actorId) return false

    const start = Date.now()
    logger.debug('FIREBASE_START isActorAnnouncedStatus')
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('originalStatusId', '==', statusId)
      .where('type', '==', 'Announce')
      .where('actorId', '==', actorId)
      .count()
      .get()

    logger.debug('FIREBASE_END isActorAnnouncedStatus', Date.now() - start)
    return snapshot.data().count === 1
  }

  private async getStatusFromData(
    data: any,
    withReplies: boolean,
    currentActorId?: string
  ): Promise<Status | undefined> {
    const start = Date.now()
    logger.debug('FIREBASE_START getStatusFromData')
    if (data.type === StatusType.Announce) {
      if (!data.originalStatusId) {
        console.error(
          'Announce status original status id is undefined',
          data.id
        )
        return
      }

      const snapshot = await this.db
        .doc(`statuses/${FirebaseStorage.urlToId(data.originalStatusId)}`)
        .get()
      const originalStatusData = snapshot.data()
      if (!originalStatusData) return

      if (originalStatusData.type === StatusType.Announce) {
        console.error(
          'Announce status announce another status',
          data.id,
          data.originalStatusId
        )
        return
      }

      const [originalStatus, actor] = await Promise.all([
        this.getStatusFromData(originalStatusData, withReplies, currentActorId),
        this.getActorFromId({
          id: data.actorId
        })
      ])
      if (!originalStatus) return
      logger.debug('FIREBASE_END getStatusFromData', Date.now() - start)
      return new Status({
        id: data.id,
        actorId: data.actorId,
        actor: actor?.toProfile() ?? null,
        type: data.type,

        to: data.to,
        cc: data.cc,

        originalStatus: originalStatus?.data as StatusNote,

        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      })
    }

    const [
      attachments,
      tags,
      actor,
      totalLikes,
      isActorLikedStatus,
      isActorAnnouncedStatus
    ] = await Promise.all([
      this.getAttachments({ statusId: data.id }),
      this.getTags({ statusId: data.id }),
      this.getActorFromId({ id: data.actorId }),
      this.getLikeCount({ statusId: data.id }),
      this.isActorLikedStatus(data.id, currentActorId),
      this.isActorAnnouncedStatus(data.id, currentActorId)
    ])

    const replies = withReplies ? await this.getReplies(data.id) : []
    logger.debug('FIREBASE_END getStatusFromData', Date.now() - start)
    return new Status({
      id: data.id,
      url: data.url,
      to: data.to,
      cc: data.cc,
      actorId: data.actorId,
      actor: actor?.toProfile() ?? null,
      type: data.type,
      text: data.text,
      summary: data.summary,
      reply: data.reply,
      replies,
      totalLikes,
      isActorLiked: isActorLikedStatus,
      isActorAnnounced: isActorAnnouncedStatus,
      attachments: attachments.map((attachment) => attachment.toJson()),
      tags: tags.map((tag) => tag.toJson()),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    })
  }

  private async getStatusWithCurrentActor(
    statusId: string,
    currentActorId?: string
  ) {
    const start = Date.now()
    logger.debug('FIREBASE_START getStatusWithCurrentActor')

    const snapshot = await this.db
      .doc(`statuses/${FirebaseStorage.urlToId(statusId)}`)
      .get()
    const data = snapshot.data()
    if (!data) return
    logger.debug('FIREBASE_END getStatusWithCurrentActor ', Date.now() - start)
    return this.getStatusFromData(data, true, currentActorId)
  }

  async getStatus({ statusId }: GetStatusParams) {
    return this.getStatusWithCurrentActor(statusId)
  }

  async getStatuses({ actorId }: GetStatusesParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START get statuses')
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('localRecipients', 'array-contains', actorId)
      .where('localActorForReply', 'in', ['', actorId])
      .orderBy('createdAt', 'desc')
      .limit(PER_PAGE_LIMIT)
      .get()
    const items = await Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data()
        return this.getStatusFromData(data, false, actorId)
      })
    )
    logger.debug('FIREBASE_END get statuses', Date.now() - start)
    return items.filter((status): status is Status => Boolean(status))
  }

  async getTimeline({ timeline, actorId }: GetTimelineParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getTimeline')
    switch (timeline) {
      case Timeline.LocalPublic: {
        const actors = await this.db
          .collection('actors')
          .where('privateKey', '!=', '')
          .get()
        const actorIds = actors.docs.map((doc) => doc.data().id)
        // TODO: Add new index when create status for timeline
        const actorsDocuments = await Promise.all(
          actorIds.map((actorId) =>
            this.db
              .collection('statuses')
              .where('actorId', '==', actorId)
              .where(
                'to',
                'array-contains',
                'https://www.w3.org/ns/activitystreams#Public'
              )
              .where('reply', '==', '')
              .orderBy('createdAt', 'desc')
              .limit(PER_PAGE_LIMIT)
              .get()
          )
        )
        const statuses = await Promise.all(
          actorsDocuments
            .map((item) => item.docs)
            .flat()
            .map((doc) => doc.data())
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((data) => this.getStatusFromData(data, false))
        )
        logger.debug('FIREBASE_END getTimeline', Date.now() - start)
        return statuses
          .filter((status): status is Status => Boolean(status))
          .slice(0, 30)
      }
      case Timeline.MAIN: {
        if (!actorId) return []

        const snapshot = await this.db
          .collection(`actors/${FirebaseStorage.urlToId(actorId)}/timelines`)
          .where('timeline', '==', timeline)
          .orderBy('createdAt', 'desc')
          .limit(30)
          .get()
        const statuses = await Promise.all(
          snapshot.docs
            .map((doc) => doc.data().statusId)
            .map((statusId) => this.getStatus({ statusId }))
        )
        return statuses.filter(
          (status): status is Status => status !== undefined
        )
      }
      default: {
        return []
      }
    }
  }

  async createTimelineStatus({
    status,
    timeline,
    actorId
  }: CreateTimelineStatusParams): Promise<void> {
    const currentTime = Date.now()
    logger.debug('FIREBASE_START addTimelineStatus')
    const path = `actors/${FirebaseStorage.urlToId(
      actorId
    )}/timelines/${timeline}-${FirebaseStorage.urlToId(status.id)}`
    await this.db.doc(path).set({
      timeline,
      statusId: status.id,
      statusActorId: status.actorId,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    logger.debug('FIREBASE_END addTimelineStatus', Date.now() - currentTime)
  }

  async getActorStatusesCount({ actorId }: GetActorStatusesCountParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getActorStatusesCount')
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .count()
      .get()
    logger.debug('FIREBASE_END getActorStatusesCount', Date.now() - start)
    return snapshot.data().count
  }

  async getActorStatuses({ actorId }: GetActorStatusesParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getActorStatuses')
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .where('reply', '==', '')
      .orderBy('createdAt', 'desc')
      .limit(PER_PAGE_LIMIT)
      .get()
    const items = await Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data()
        return this.getStatusFromData(data, false)
      })
    )
    logger.debug('FIREBASE_END getActorStatuses', Date.now() - start)
    return items.filter((item): item is Status => Boolean(item))
  }

  async deleteStatus({ statusId }: DeleteStatusParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START deleteStatus')

    const repliesSnapshot = await this.db
      .collection('statuses')
      .where('reply', '==', statusId)
      .get()

    await Promise.all(
      repliesSnapshot.docs
        .map((doc) => doc.data().id)
        .map((statusId) => this.deleteStatus({ statusId }))
    )

    const statusInTimelines = await this.db
      .collectionGroup('timelines')
      .where('statusId', '==', statusId)
      .get()

    await Promise.all([
      ...statusInTimelines.docs.map((doc) => doc.ref.delete()),
      this.db.doc(`statuses/${FirebaseStorage.urlToId(statusId)}`).delete()
    ])

    logger.debug('FIREBASE_END deleteStatus', Date.now() - start)
  }

  async createAttachment({
    statusId,
    mediaType,
    url,
    width,
    height,
    name = ''
  }: CreateAttachmentParams): Promise<Attachment> {
    const start = Date.now()
    logger.debug('FIREBASE_START createAttachment')
    const currentTime = Date.now()
    const id = crypto.randomUUID()
    const data: AttachmentData = {
      id,
      statusId,
      type: 'Document',
      mediaType,
      url,
      ...(width ? { width } : null),
      ...(height ? { height } : null),
      name,

      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.db
      .doc(`statuses/${FirebaseStorage.urlToId(statusId)}/attachments/${id}`)
      .set(data)
    logger.debug('FIREBASE_END createAttachment', Date.now() - start)
    return new Attachment(data)
  }

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getAttachments')
    const snapshot = await this.db
      .collection(`statuses/${FirebaseStorage.urlToId(statusId)}/attachments`)
      .get()
    logger.debug('FIREBASE_END getAttachments', Date.now() - start)
    return snapshot.docs.map(
      (item) => new Attachment(item.data() as AttachmentData)
    )
  }

  async createTag({ statusId, name, value }: CreateTagParams): Promise<Tag> {
    const start = Date.now()
    logger.debug('FIREBASE_START createTag')
    const currentTime = Date.now()
    const id = crypto.randomUUID()
    const data: TagData = {
      id,
      statusId,
      type: 'mention',
      name,
      value: value || '',
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.db
      .doc(`statuses/${FirebaseStorage.urlToId(statusId)}/tags/${id}`)
      .set(data)
    logger.debug('FIREBASE_END createTag', Date.now() - start)
    return new Tag(data)
  }

  async getTags({ statusId }: GetTagsParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getTags')
    const snapshot = await this.db
      .collection(`statuses/${FirebaseStorage.urlToId(statusId)}/tags`)
      .get()
    logger.debug('FIREBASE_END getTags', Date.now() - start)
    return snapshot.docs.map((item) => new Tag(item.data() as TagData))
  }

  private async getReplies(statusId: string) {
    const start = Date.now()
    logger.debug('FIREBASE_START getReplies')
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('reply', '==', statusId)
      .orderBy('createdAt', 'desc')
      .get()
    const replies = await Promise.all(
      snapshot.docs.map(async (item) => {
        const data = item.data()
        const status = await this.getStatusFromData(data, false)
        if (!status) return null
        if (status.data.type !== StatusType.Note) return null
        return status.data
      })
    )
    logger.debug('FIREBASE_END getReplies', Date.now() - start)
    return replies.filter((item): item is StatusNote => Boolean(item))
  }

  async createLike({ actorId, statusId }: CreateLikeParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START createLike')
    const snapshot = await this.db
      .doc(`statuses/${FirebaseStorage.urlToId(statusId)}`)
      .get()
    if (!snapshot.exists) return

    const currentTime = Date.now()
    const isLiked = await this.isActorLikedStatus(statusId, actorId)
    if (isLiked) return

    await this.db
      .doc(
        `statuses/${FirebaseStorage.urlToId(
          statusId
        )}/likes/${FirebaseStorage.urlToId(actorId)}`
      )
      .set({
        actorId,
        statusId,
        createdAt: currentTime,
        updatedAt: currentTime
      })
    logger.debug('FIREBASE_END createLike', Date.now() - start)
  }

  async deleteLike({ statusId, actorId }: DeleteLikeParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START deleteLike')
    await this.db
      .doc(
        `statuses/${FirebaseStorage.urlToId(
          statusId
        )}/likes/${FirebaseStorage.urlToId(actorId)}`
      )
      .delete()
    logger.debug('FIREBASE_END deleteLike', Date.now() - start)
  }

  async getLikeCount({ statusId }: GetLikeCountParams) {
    const start = Date.now()
    logger.debug('FIREBASE_START getLikeCount')
    const countSnapshot = await this.db
      .collection(`statuses/${FirebaseStorage.urlToId(statusId)}/likes`)
      .count()
      .get()
    logger.debug('FIREBASE_END getLikeCount', Date.now() - start)
    return countSnapshot.data().count ?? 0
  }

  private async isActorLikedStatus(statusId: string, actorId?: string) {
    const start = Date.now()
    logger.debug('FIREBASE_START isActorLikedStatus')
    if (!actorId) return false

    const snapshot = await this.db
      .doc(
        `statuses/${FirebaseStorage.urlToId(
          statusId
        )}/likes/${FirebaseStorage.urlToId(actorId)}`
      )
      .get()
    logger.debug('FIREBASE_END isActorLikedStatus', Date.now() - start)
    return snapshot.exists
  }
}
