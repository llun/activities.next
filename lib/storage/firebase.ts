import { Firestore, Settings } from '@google-cloud/firestore'
import crypto from 'crypto'

import { PER_PAGE_LIMIT, deliverTo } from '.'
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
import {
  CreateAccountParams,
  CreateActorParams,
  CreateAnnounceParams,
  CreateAttachmentParams,
  CreateFollowParams,
  CreateLikeParams,
  CreateNoteParams,
  CreateTagParams,
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
  GetLocalFollowersForActorIdParams,
  GetStatusParams,
  GetStatusesParams,
  GetTagsParams,
  GetTimelineParams,
  IsAccountExistsParams,
  IsCurrentActorFollowingParams,
  IsUsernameExistsParams,
  Storage,
  Timeline,
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
    console.log('isAccountExists start', Date.now())
    const accounts = this.db.collection('accounts')
    const snapshot = await accounts.where('email', '==', email).count().get()
    console.log('isAccountExists end', Date.now())
    return snapshot.data().count === 1
  }

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    console.log('isUsernameExists start', Date.now())
    const accounts = this.db.collection('actors')
    const snapshot = await accounts
      .where('username', '==', username)
      .where('domain', '==', domain)
      .count()
      .get()
    console.log('isUsernameExists end', Date.now())
    return snapshot.data().count === 1
  }

  async createAccount({
    email,
    username,
    domain,
    privateKey,
    publicKey
  }: CreateAccountParams) {
    console.log('createAccount start', Date.now())
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

    const actors = this.db.collection('actors')
    await actors.add({
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
    console.log('createAccount end', Date.now())

    return accountRef.id
  }

  async getAccountFromId({ id }: GetAccountFromIdParams) {
    console.log('getAccountFromId start', Date.now())
    const accounts = this.db.collection('accounts')
    const snapshot = await accounts.doc(id).get()
    if (!snapshot) return
    console.log('getAccountFromId end', Date.now())
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
    console.log('createActor start', Date.now())
    const currentTime = Date.now()
    const actors = this.db.collection('actors')
    await actors.add({
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
    })
    console.log('createActor end', Date.now())
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
    console.log('getActorFromEmail start', Date.now())
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

    console.log('getActorFromEmail end', Date.now())
    return this.getActorFromDataAndAccount(data, account)
  }

  async getActorFromUsername({ username, domain }: GetActorFromUsernameParams) {
    console.log('getActorFromUsername start', Date.now())
    const actors = this.db.collection('actors')
    const snapshot = await actors
      .where('username', '==', username)
      .where('domain', '==', domain)
      .limit(1)
      .get()
    if (snapshot.docs.length !== 1) return undefined

    const data = snapshot.docs[0].data()
    if (!data.accountId) {
      console.log('getActorFromUsername end', Date.now())
      return this.getActorFromDataAndAccount(data)
    }

    const account = await this.getAccountFromId({ id: data.accountId })
    console.log('getActorFromUsername end', Date.now())
    return this.getActorFromDataAndAccount(data, account)
  }

  async getActorFromId({ id }: GetActorFromIdParams) {
    console.log('getActorFromId start', Date.now())
    const actors = this.db.collection('actors')
    const snapshot = await actors.where('id', '==', id).limit(1).get()
    if (snapshot.docs.length !== 1) return

    const data = snapshot.docs[0].data()
    if (!data.accountId) {
      console.log('getActorFromId end', Date.now())
      return this.getActorFromDataAndAccount(data)
    }

    const account = await this.getAccountFromId({ id: data.accountId })
    console.log('getActorFromId end', Date.now())
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
    console.log('updateActor start', Date.now())
    const actors = this.db.collection('actors')
    const snapshot = await actors.where('id', '==', actorId).limit(1).get()
    if (snapshot.docs.length !== 1) return undefined

    const currentTime = Date.now()
    await actors.doc(snapshot.docs[0].id).update({
      ...snapshot.docs[0].data(),
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
    console.log('updateActor end', Date.now())
    return this.getActorFromId({ id: actorId })
  }

  async deleteActor({ actorId }: DeleteActorParams): Promise<void> {
    console.log('deleteActor start', Date.now())
    const actors = this.db.collection('actors')
    const snapshot = await actors.where('id', '==', actorId).get()
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
    console.log('deleteActor end', Date.now())
  }

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams) {
    console.log('isCurrentActorFollowing start', Date.now())
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', currentActorId)
      .where('targetActorId', '==', followingActorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    console.log('isCurrentActorFollowing end', Date.now())
    return snapshot.data().count > 0
  }

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    console.log('getActorFollowingCount start', Date.now())
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', actorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    console.log('getActorFollowingCount end', Date.now())
    return snapshot.data().count
  }

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    console.log('getActorFollowersCount start', Date.now())
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', actorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    console.log('getActorFollowersCount end', Date.now())
    return snapshot.data().count
  }

  async createFollow({
    actorId,
    targetActorId,
    status,
    inbox,
    sharedInbox
  }: CreateFollowParams) {
    console.log('createFollow start', Date.now())
    const existingFollow = await this.getAcceptedOrRequestedFollow({
      actorId,
      targetActorId
    })
    if (existingFollow) {
      console.log('createFollow end', Date.now())
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
    console.log('createFollow end', Date.now())
    return {
      id: ref.id,
      ...content
    }
  }

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    console.log('getFollowFromId start', Date.now())
    const follows = this.db.collection('follows')
    const snapshot = await follows.doc(followId).get()
    if (!snapshot) return

    const data = snapshot.data()
    console.log('getFollowFromId end', Date.now())
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
    console.log('getLocalFollowersForActorId start', Date.now())
    const actor = await this.getActorFromId({ id: targetActorId })
    // External actor, all followers are internal
    if (!actor?.privateKey) {
      const follows = this.db.collection('follows')
      const snapshot = await follows
        .where('targetActorId', '==', targetActorId)
        .where('status', '==', FollowStatus.Accepted)
        .get()

      console.log('getLocalFollowersForActorId end', Date.now())
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

    console.log('getLocalFollowersForActorId end', Date.now())
    return snapshot.docs.map((doc) => doc.data() as Follow)
  }

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams) {
    console.log('getAcceptedOrRequestedFollow start', Date.now())
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
    console.log('getAcceptedOrRequestedFollow end', Date.now())
    return {
      ...data,
      id: document.id,
      actorHost: new URL(data.actorId).host,
      targetActorHost: new URL(data.targetActorId).host
    } as Follow
  }

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    console.log('getFollowersInbox start', Date.now())
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', FollowStatus.Accepted)
      .get()
    console.log('getFollowersInbox end', Date.now())
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
    const follow = await this.getFollowFromId({ followId })
    if (!follow) return

    console.log('getFollowersInbox start', Date.now())
    const ref = this.db.collection('follows').doc(follow.id)
    await ref.update({
      status,
      updatedAt: Date.now()
    })
    console.log('getFollowersInbox end', Date.now())
  }

  private async getLocalActorFromReply(actorId?: string, reply?: string) {
    console.log('getLocalActorFromReply start', Date.now())
    if (actorId) {
      const actor = await this.getActorFromId({ id: actorId })
      console.log('getLocalActorFromReply end', Date.now())
      if (actor?.privateKey) return actorId
    }

    console.log('getLocalActorFromReply end', Date.now())
    if (!reply) return ''

    const localActors = await this.db
      .collection('actors')
      .where('privateKey', '!=', '')
      .get()
    const domains = localActors.docs.map((doc) => doc.data().domain)
    const url = new URL(reply)

    console.log('getLocalActorFromReply end', Date.now())
    if (!domains.includes(url.hostname)) return 'external'
    console.log('getLocalActorFromReply end', Date.now())
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
    console.log('createNote start', Date.now())
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
    const statuses = this.db.collection('statuses')
    await statuses.add({
      ...status,
      localRecipients: local,
      localActorForReply: await this.getLocalActorFromReply(actorId, reply)
    })

    const actor = await this.getActorFromId({ id: actorId })
    console.log('createNote end', Date.now())
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
    console.log('createAnnounce start', Date.now())
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

    const statuses = this.db.collection('statuses')
    await statuses.add(status)

    const originalStatus = await this.getStatus({ statusId: originalStatusId })
    const announceData: StatusAnnounce = {
      ...status,
      originalStatus: originalStatus?.data
    }
    console.log('createAnnounce end', Date.now())
    return new Status(announceData)
  }

  private async isActorAnnouncedStatus(statusId: string, actorId?: string) {
    if (!actorId) return false

    console.log('isActorAnnouncedStatus start', Date.now())
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('originalStatusId', '==', statusId)
      .where('type', '==', 'Announce')
      .where('actorId', '==', actorId)
      .count()
      .get()

    console.log('isActorAnnouncedStatus end', Date.now())
    return snapshot.data().count === 1
  }

  private async getStatusFromData(
    data: any,
    withReplies: boolean,
    currentActorId?: string
  ): Promise<Status | undefined> {
    console.log('getStatusFromData start', Date.now())
    if (data.type === StatusType.Announce) {
      if (!data.originalStatusId) {
        console.error(
          'Announce status original status id is undefined',
          data.id
        )
        return
      }

      const statuses = this.db.collection('statuses')
      const snapshot = await statuses
        .where('id', '==', data.originalStatusId)
        .limit(1)
        .get()
      if (snapshot.docs.length !== 1) return

      const originalStatusData = snapshot.docs[0].data()
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
      console.log('getStatusFromData end', Date.now())
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
    console.log('getStatusFromData end', Date.now())
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
    console.log('getStatusWithCurrentActor start', Date.now())
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses.where('id', '==', statusId).limit(1).get()
    if (snapshot.docs.length !== 1) return
    const data = snapshot.docs[0].data()
    console.log('getStatusWithCurrentActor end', Date.now())
    return this.getStatusFromData(data, true, currentActorId)
  }

  async getStatus({ statusId }: GetStatusParams) {
    return this.getStatusWithCurrentActor(statusId)
  }

  async getStatuses({ actorId }: GetStatusesParams) {
    console.log('get statuses start', Date.now())
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
    console.log('get statuses end', Date.now())
    return items.filter((status): status is Status => Boolean(status))
  }

  async getTimeline({ timeline }: GetTimelineParams) {
    console.log('getTimeline start', Date.now())
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
        console.log('getTimeline end', Date.now())
        return statuses
          .filter((status): status is Status => Boolean(status))
          .slice(0, 30)
      }
      default: {
        return []
      }
    }
  }

  async getActorStatusesCount({ actorId }: GetActorStatusesCountParams) {
    console.log('getActorStatusesCount start', Date.now())
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .count()
      .get()
    console.log('getActorStatusesCount end', Date.now())
    return snapshot.data().count
  }

  async getActorStatuses({ actorId }: GetActorStatusesParams) {
    console.log('getActorStatuses start', Date.now())
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
    console.log('getActorStatuses end', Date.now())
    return items.filter((item): item is Status => Boolean(item))
  }

  async deleteStatus({ statusId }: DeleteStatusParams) {
    console.log('deleteStatus start', Date.now())
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses.where('id', '==', statusId).get()
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
    console.log('deleteStatus end', Date.now())
  }

  async createAttachment({
    statusId,
    mediaType,
    url,
    width,
    height,
    name = ''
  }: CreateAttachmentParams): Promise<Attachment> {
    console.log('createAttachment start', Date.now())
    const currentTime = Date.now()
    const data: AttachmentData = {
      id: crypto.randomUUID(),
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
    const attachments = this.db.collection('attachments')
    await attachments.add(data)
    console.log('createAttachment end', Date.now())
    return new Attachment(data)
  }

  async getAttachments({ statusId }: GetAttachmentsParams) {
    console.log('getAttachments start', Date.now())
    const attachments = this.db.collection('attachments')
    const snapshot = await attachments.where('statusId', '==', statusId).get()
    console.log('getAttachments end', Date.now())
    return snapshot.docs.map(
      (item) => new Attachment(item.data() as AttachmentData)
    )
  }

  async createTag({ statusId, name, value }: CreateTagParams): Promise<Tag> {
    console.log('createTag start', Date.now())
    const currentTime = Date.now()
    const data: TagData = {
      id: crypto.randomUUID(),
      statusId,
      type: 'mention',
      name,
      value: value || '',
      createdAt: currentTime,
      updatedAt: currentTime
    }
    const tags = this.db.collection('tags')
    await tags.add(data)
    console.log('createTag end', Date.now())
    return new Tag(data)
  }

  async getTags({ statusId }: GetTagsParams) {
    console.log('getTags start', Date.now())
    const tags = this.db.collection('tags')
    const snapshot = await tags.where('statusId', '==', statusId).get()
    console.log('getTags end', Date.now())
    return snapshot.docs.map((item) => new Tag(item.data() as TagData))
  }

  private async getReplies(statusId: string) {
    console.log('getReplies start', Date.now())
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
    console.log('getReplies end', Date.now())
    return replies.filter((item): item is StatusNote => Boolean(item))
  }

  async createLike({ actorId, statusId }: CreateLikeParams) {
    console.log('createLike start', Date.now())
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses.where('id', '==', statusId).limit(1).get()
    if (snapshot.docs.length !== 1) return

    const currentTime = Date.now()
    const likes = this.db.collection('likes')
    const countSnapshot = await likes
      .where('statusId', '==', statusId)
      .where('actorId', '==', actorId)
      .count()
      .get()
    if (countSnapshot.data().count === 1) {
      return
    }

    await likes.add({
      actorId,
      statusId,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    console.log('createLike end', Date.now())
  }

  async deleteLike({ statusId, actorId }: DeleteLikeParams) {
    console.log('deleteLike start', Date.now())
    const likes = this.db.collection('likes')
    const snapshot = await likes
      .where('statusId', '==', statusId)
      .where('actorId', '==', actorId)
      .get()
    console.log('deleteLike end', Date.now())
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
  }

  async getLikeCount({ statusId }: GetLikeCountParams) {
    console.log('getLikeCount start', Date.now())
    const likes = this.db.collection('likes')
    const countSnapshot = await likes
      .where('statusId', '==', statusId)
      .count()
      .get()
    console.log('getLikeCount end', Date.now())
    return countSnapshot.data().count ?? 0
  }

  private async isActorLikedStatus(statusId: string, actorId?: string) {
    console.log('isActorLikedStatus start', Date.now())
    if (!actorId) return false

    const likes = this.db.collection('likes')
    const snapshot = await likes
      .where('statusId', '==', statusId)
      .where('actorId', '==', actorId)
      .count()
      .get()
    console.log('isActorLikedStatus end', Date.now())
    return snapshot.data().count === 1
  }
}
