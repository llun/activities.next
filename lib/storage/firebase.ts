import { Firestore as ServerFirestore, Settings } from '@google-cloud/firestore'
import crypto from 'crypto'

import { deliverTo } from '.'
import { getConfig } from '../config'
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
  CreateNoteParams,
  CreateTagParams,
  DeleteActorParams,
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
  GetLocalFollowersForActorIdParams,
  GetStatusParams,
  GetStatusesParams,
  GetTagsParams,
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
  readonly db: ServerFirestore

  constructor(config: FirebaseConfig) {
    this.db = new ServerFirestore(config)
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
    const accounts = this.db.collection('accounts')
    const snapshot = await accounts.where('email', '==', email).count().get()
    return snapshot.data().count === 1
  }

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    const accounts = this.db.collection('actors')
    const snapshot = await accounts
      .where('username', '==', username)
      .where('domain', '==', domain)
      .count()
      .get()
    return snapshot.data().count === 1
  }

  async createAccount({
    email,
    username,
    domain,
    privateKey,
    publicKey
  }: CreateAccountParams) {
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

    return accountRef.id
  }

  async getAccountFromId({ id }: GetAccountFromIdParams) {
    const accounts = this.db.collection('accounts')
    const snapshot = await accounts.doc(id).get()
    if (!snapshot) return

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

    return this.getActorFromDataAndAccount(data, account)
  }

  async getActorFromUsername({ username, domain }: GetActorFromUsernameParams) {
    const actors = this.db.collection('actors')
    const snapshot = await actors
      .where('username', '==', username)
      .where('domain', '==', domain)
      .limit(1)
      .get()
    if (snapshot.docs.length !== 1) return undefined

    const data = snapshot.docs[0].data()
    if (!data.accountId) {
      return this.getActorFromDataAndAccount(data)
    }

    const account = await this.getAccountFromId({ id: data.accountId })
    return this.getActorFromDataAndAccount(data, account)
  }

  async getActorFromId({ id }: GetActorFromIdParams) {
    const actors = this.db.collection('actors')
    const snapshot = await actors.where('id', '==', id).limit(1).get()
    if (snapshot.docs.length !== 1) return

    const data = snapshot.docs[0].data()
    if (!data.accountId) {
      return this.getActorFromDataAndAccount(data)
    }

    const account = await this.getAccountFromId({ id: data.accountId })
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
    return this.getActorFromId({ id: actorId })
  }

  async deleteActor({ actorId }: DeleteActorParams): Promise<void> {
    const actors = this.db.collection('actors')
    const snapshot = await actors.where('id', '==', actorId).limit(1).get()

    if (snapshot.docs.length !== 1) return
    await actors.doc(snapshot.docs[0].id).delete()
  }

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams) {
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', currentActorId)
      .where('targetActorId', '==', followingActorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    return snapshot.data().count > 0
  }

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', actorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    return snapshot.data().count
  }

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', actorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    return snapshot.data().count
  }

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
    const follows = this.db.collection('follows')
    const ref = await follows.add(content)
    return {
      id: ref.id,
      ...content
    }
  }

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    const follows = this.db.collection('follows')
    const snapshot = await follows.doc(followId).get()
    if (!snapshot) return

    const data = snapshot.data()
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
    const url = new URL(targetActorId)
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', targetActorId)
      .where('actorHost', '==', url.hostname)
      .where('status', '==', FollowStatus.Accepted)
      .get()
    return snapshot.docs.map((doc) => doc.data() as Follow)
  }

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams) {
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
    return {
      ...data,
      id: document.id,
      actorHost: new URL(data.actorId).host,
      targetActorHost: new URL(data.targetActorId).host
    } as Follow
  }

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', targetActorId)
      .where('status', '==', FollowStatus.Accepted)
      .get()
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

    const ref = this.db.collection('follows').doc(follow.id)
    await ref.update({
      status,
      updatedAt: Date.now()
    })
  }

  static getLocalActorFromReply(actorId?: string, reply?: string) {
    const host = `https://${getConfig().host}`
    if (actorId?.startsWith(host)) return actorId

    if (!reply) return ''
    if (!reply.startsWith(host)) return 'external'
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
      localActorForReply: FirebaseStorage.getLocalActorFromReply(actorId, reply)
    })

    const actor = await this.getActorFromId({ id: actorId })
    return new Status({
      ...status,
      actor: actor?.toProfile() || null,
      attachments: [],
      boostedByStatusesId: [],
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
      localActorForReply: FirebaseStorage.getLocalActorFromReply(actorId, ''),
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
    return new Status(announceData)
  }

  private async getBoostedByStatuses(statusId: string) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('originalStatusId', '==', statusId)
      .get()
    return snapshot.docs.map((doc) => {
      const data = doc.data()
      return data.id
    })
  }

  private async getStatusFromData(
    data: any,
    withReplies: boolean
  ): Promise<Status> {
    if (data.type === StatusType.Announce) {
      const [originalStatus, actor] = await Promise.all([
        this.getStatus({
          statusId: data.originalStatusId
        }),
        this.getActorFromId({
          id: data.actorId
        })
      ])

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

    const [attachments, tags, actor, boostedByStatusesId] = await Promise.all([
      this.getAttachments({ statusId: data.id }),
      this.getTags({ statusId: data.id }),
      this.getActorFromId({ id: data.actorId }),
      this.getBoostedByStatuses(data.id)
    ])
    const replies = withReplies ? await this.getReplies(data.id) : []
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
      boostedByStatusesId,
      attachments: attachments.map((attachment) => attachment.toJson()),
      tags: tags.map((tag) => tag.toJson()),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    })
  }

  async getStatus({ statusId }: GetStatusParams) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses.where('id', '==', statusId).limit(1).get()
    if (snapshot.docs.length !== 1) return
    const data = snapshot.docs[0].data()
    return this.getStatusFromData(data, true)
  }

  async getStatuses({ actorId }: GetStatusesParams) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('localRecipients', 'array-contains', actorId)
      .where('localActorForReply', 'in', ['', actorId])
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get()
    return Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data()
        return this.getStatusFromData(data, false)
      })
    )
  }

  async getActorStatusesCount({ actorId }: GetActorStatusesCountParams) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .count()
      .get()
    return snapshot.data().count
  }

  async getActorStatuses({ actorId }: GetActorStatusesParams) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .where('reply', '==', '')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get()
    return Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data()
        return this.getStatusFromData(data, false)
      })
    )
  }

  async deleteStatus({ statusId }: DeleteStatusParams) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses.where('id', '==', statusId).limit(1).get()
    if (snapshot.docs.length !== 1) return

    const document = snapshot.docs[0]
    await statuses.doc(document.id).delete()
  }

  async createAttachment({
    statusId,
    mediaType,
    url,
    width,
    height,
    name = ''
  }: CreateAttachmentParams): Promise<Attachment> {
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
    return new Attachment(data)
  }

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const attachments = this.db.collection('attachments')
    const snapshot = await attachments.where('statusId', '==', statusId).get()
    return snapshot.docs.map(
      (item) => new Attachment(item.data() as AttachmentData)
    )
  }

  async createTag({ statusId, name, value }: CreateTagParams): Promise<Tag> {
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
    return new Tag(data)
  }

  async getTags({ statusId }: GetTagsParams) {
    const tags = this.db.collection('tags')
    const snapshot = await tags.where('statusId', '==', statusId).get()
    return snapshot.docs.map((item) => new Tag(item.data() as TagData))
  }

  private async getReplies(statusId: string) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('reply', '==', statusId)
      .orderBy('createdAt', 'desc')
      .get()
    const replies = await Promise.all(
      snapshot.docs.map(async (item) => {
        const data = item.data()
        const status = await this.getStatusFromData(data, false)
        if (status.data.type !== StatusType.Note) return null
        return status.data
      })
    )
    return replies.filter((item): item is StatusNote => Boolean(item))
  }
}
