import { Firestore, Settings } from '@google-cloud/firestore'
import crypto from 'crypto'

import { PER_PAGE_LIMIT } from '.'
import { Account } from '../models/account'
import { Actor } from '../models/actor'
import { Attachment, AttachmentData } from '../models/attachment'
import { Follow, FollowStatus } from '../models/follow'
import { PollChoice, PollChoiceData } from '../models/pollChoice'
import { Session } from '../models/session'
import {
  Edited,
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '../models/status'
import { Tag, TagData } from '../models/tag'
import { Timeline } from '../timelines/types'
import { Trace } from '../trace'
import {
  CreateActorParams,
  CreateAnnounceParams,
  CreateAttachmentParams,
  CreateFollowParams,
  CreateNoteParams,
  CreatePollParams,
  CreateTagParams,
  CreateTimelineStatusParams,
  DeleteActorParams,
  DeleteStatusParams,
  GetAcceptedOrRequestedFollowParams,
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
  GetLocalActorsFromFollowerUrlParams,
  GetLocalFollowersForActorIdParams,
  GetStatusParams,
  GetStatusRepliesParams,
  GetTagsParams,
  GetTimelineParams,
  HasActorAnnouncedStatusParams,
  IsCurrentActorFollowingParams,
  Storage,
  UpdateActorParams,
  UpdateFollowStatusParams,
  UpdateNoteParams,
  UpdatePollParams
} from './types'
import {
  CreateAccountParams,
  CreateAccountSessionParams,
  DeleteAccountSessionParams,
  GetAccountAllSessionsParams,
  GetAccountFromIdParams,
  GetAccountFromProviderIdParams,
  GetAccountSessionParams,
  IsAccountExistsParams,
  IsUsernameExistsParams,
  LinkAccountWithProviderParams,
  UpdateAccountSessionParams
} from './types/acount'
import {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams
} from './types/like'
import { CreateMediaParams, Media } from './types/media'

export interface FirestoreConfig extends Settings {
  type: 'firebase' | 'firestore'
}

export class FirestoreStorage implements Storage {
  readonly db: Firestore

  constructor(config: FirestoreConfig) {
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

  @Trace('db')
  async isAccountExists({ email }: IsAccountExistsParams) {
    const accounts = this.db.collection('accounts')
    const snapshot = await accounts.where('email', '==', email).count().get()
    return snapshot.data().count === 1
  }

  @Trace('db')
  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    const accounts = this.db.collection('actors')
    const snapshot = await accounts
      .where('username', '==', username)
      .where('domain', '==', domain)
      .count()
      .get()
    return snapshot.data().count === 1
  }

  @Trace('db')
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

    await this.db.doc(`actors/${FirestoreStorage.urlToId(actorId)}`).set({
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

  @Trace('db')
  async getAccountFromId({ id }: GetAccountFromIdParams) {
    const accounts = this.db.collection('accounts')
    const snapshot = await accounts.doc(id).get()
    if (!snapshot) return
    return {
      ...snapshot.data(),
      id
    } as Account
  }

  @Trace('db')
  async getAccountFromProviderId({
    provider,
    accountId
  }: GetAccountFromProviderIdParams): Promise<Account | undefined> {
    const providers = await this.db
      .collectionGroup('accountProviders')
      .where('provider', '==', provider)
      .where('providerAccountId', '==', accountId)
      .get()
    if (providers.size !== 1) return

    const providerDoc = providers.docs[0]
    return this.getAccountFromId({
      id: providerDoc.data().accountId
    })
  }

  @Trace('db')
  async linkAccountWithProvider({
    accountId,
    providerAccountId,
    provider
  }: LinkAccountWithProviderParams): Promise<Account | undefined> {
    const providers = await this.db
      .collectionGroup('accountProviders')
      .where('provider', '==', provider)
      .where('accountId', '==', accountId)
      .get()
    if (providers.size === 1) return

    const account = await this.db.doc(`accounts/${accountId}`).get()
    if (!account.exists) return

    const currentTime = Date.now()
    await this.db
      .doc(`accounts/${accountId}/accountProviders/${provider}`)
      .set({
        accountId,
        provider,
        providerAccountId,

        createdAt: currentTime,
        updatedAt: currentTime
      })
  }

  @Trace('db')
  async createAccountSession({
    accountId,
    expireAt,
    token
  }: CreateAccountSessionParams): Promise<void> {
    const currentTime = Date.now()
    await this.db.doc(`accounts/${accountId}/sessions/${token}`).set({
      accountId,
      token,
      expireAt,
      createdAt: currentTime,
      updatedAt: currentTime
    })
  }

  @Trace('db')
  async getAccountSession({
    token
  }: GetAccountSessionParams): Promise<
    { account: Account; session: Session } | undefined
  > {
    const tokenDocs = await this.db
      .collectionGroup('sessions')
      .where('token', '==', token)
      .get()
    if (tokenDocs.size !== 1) return

    const session = tokenDocs.docs[0].data() as Session
    const account = await this.getAccountFromId({ id: session.accountId })
    if (!account) return

    return { account, session }
  }

  @Trace('db')
  async getAccountAllSessions({
    accountId
  }: GetAccountAllSessionsParams): Promise<Session[]> {
    const sessionDocs = await this.db
      .collection(`accounts/${accountId}/sessions`)
      .get()
    return sessionDocs.docs.map((doc) => doc.data() as Session)
  }

  @Trace('db')
  async updateAccountSession({
    token,
    expireAt
  }: UpdateAccountSessionParams): Promise<void> {
    if (!expireAt) return

    const sessionDocs = await this.db
      .collectionGroup('sessions')
      .where('token', '==', token)
      .get()
    await Promise.all(
      sessionDocs.docs.map((doc) => doc.ref.update({ expireAt }))
    )
  }

  @Trace('db')
  async deleteAccountSession({
    token
  }: DeleteAccountSessionParams): Promise<void> {
    const sessions = await this.db
      .collectionGroup('sessions')
      .where('token', '==', token)
      .get()

    await Promise.all(sessions.docs.map((doc) => doc.ref.delete()))
  }

  @Trace('db')
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
      createdAt,
      updatedAt: currentTime
    }
    await this.db.doc(`actors/${FirestoreStorage.urlToId(actorId)}`).set(doc)
    return this.getActorFromId({ id: actorId })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  @Trace('db')
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

  @Trace('db')
  async getActorFromUsername({ username, domain }: GetActorFromUsernameParams) {
    const actors = this.db.collection('actors')
    const snapshot = await actors
      .where('username', '==', username)
      .where('domain', '==', domain)
      .limit(1)
      .get()
    if (snapshot.docs.length !== 1) return
    const data = snapshot.docs[0].data()
    if (!data.accountId) {
      return this.getActorFromDataAndAccount(data)
    }

    const account = await this.getAccountFromId({ id: data.accountId })
    return this.getActorFromDataAndAccount(data, account)
  }

  static urlToId(idInURLFormat: string) {
    const url = new URL(idInURLFormat)
    return `${url.host}:${url.pathname.slice(1).replaceAll('/', ':')}`
  }

  @Trace('db')
  async getActorFromId({ id }: GetActorFromIdParams) {
    const doc = await this.db
      .doc(`actors/${FirestoreStorage.urlToId(id)}`)
      .get()
    const data = doc.data()
    if (!data) return

    if (!data.accountId) {
      return this.getActorFromDataAndAccount(data)
    }

    const account = await this.getAccountFromId({ id: data.accountId })
    return this.getActorFromDataAndAccount(data, account)
  }

  @Trace('db')
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
    const path = `actors/${FirestoreStorage.urlToId(actorId)}`
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
    return this.getActorFromId({ id: actorId })
  }

  @Trace('db')
  async deleteActor({ actorId }: DeleteActorParams): Promise<void> {
    const actors = this.db.collection('actors')
    const snapshot = await actors.where('id', '==', actorId).get()
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
  }

  @Trace('db')
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

  @Trace('db')
  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('actorId', '==', actorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    return snapshot.data().count
  }

  @Trace('db')
  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    const follows = this.db.collection('follows')
    const snapshot = await follows
      .where('targetActorId', '==', actorId)
      .where('status', '==', FollowStatus.Accepted)
      .count()
      .get()
    return snapshot.data().count
  }

  @Trace('db')
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

  @Trace('db')
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

  @Trace('db')
  async getLocalFollowersForActorId({
    targetActorId
  }: GetLocalFollowersForActorIdParams) {
    const actor = await this.getActorFromId({ id: targetActorId })
    // External actor, all followers are internal
    if (!actor?.privateKey) {
      const follows = this.db.collection('follows')
      const snapshot = await follows
        .where('targetActorId', '==', targetActorId)
        .where('status', '==', FollowStatus.Accepted)
        .get()
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
    return snapshot.docs.map((doc) => doc.data() as Follow)
  }

  @Trace('db')
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

  @Trace('db')
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

  @Trace('db')
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

  @Trace('db')
  async updateFollowStatus({ followId, status }: UpdateFollowStatusParams) {
    const follow = await this.getFollowFromId({ followId })
    if (!follow) return

    const ref = this.db.collection('follows').doc(follow.id)
    await ref.update({
      status,
      updatedAt: Date.now()
    })
  }

  @Trace('db')
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
    await this.db.doc(`statuses/${FirestoreStorage.urlToId(id)}`).set(status)

    const actor = await this.getActorFromId({ id: actorId })
    return new Status({
      ...status,
      actor: actor?.toProfile() || null,
      attachments: [],
      totalLikes: 0,
      isActorLiked: false,
      isActorAnnounced: false,
      tags: [],
      replies: [],
      edits: []
    })
  }

  @Trace('db')
  async updateNote({
    statusId,
    text,
    summary
  }: UpdateNoteParams): Promise<Status | undefined> {
    const status = await this.getStatus({ statusId })
    if (!status) return

    const data = status.data
    if (data.type !== StatusType.Note) return

    const currentTime = Date.now()
    const previousData = {
      statusId,
      text: data.text,
      summary: data.summary,
      createdAt: status.createdAt,
      updatedAt: currentTime
    }
    const statusPath = `statuses/${FirestoreStorage.urlToId(statusId)}`
    const historyPath = `${statusPath}/history/${currentTime}`
    await this.db.doc(historyPath).set(previousData)
    await this.db.doc(statusPath).update({
      text,
      ...(summary ? { summary } : null),
      updatedAt: currentTime
    })
    return this.getStatus({ statusId })
  }

  @Trace('db')
  async createAnnounce({
    id,
    actorId,
    to,
    cc,
    originalStatusId,
    createdAt
  }: CreateAnnounceParams) {
    const currentTime = Date.now()
    const status = {
      id,
      actorId,
      type: StatusType.Announce,
      to,
      cc,
      originalStatusId,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    }

    await this.db.doc(`statuses/${FirestoreStorage.urlToId(id)}`).set(status)

    const originalStatus = await this.getStatus({
      statusId: originalStatusId,
      withReplies: false
    })
    if (!originalStatus) return
    if (originalStatus.data.type !== StatusType.Note) return

    const announceData: StatusAnnounce = {
      ...status,
      ...(originalStatus?.data && { originalStatus: originalStatus.data }),
      edits: [],
      type: StatusType.Announce,
      actor: null
    }
    return new Status(announceData)
  }

  private createMD5(content: string) {
    const hash = crypto.createHash('md5')
    hash.update(content)
    return hash.digest('hex')
  }

  private async getPollChoices(statusId: string) {
    const snapshot = await this.db
      .collection(`statuses/${FirestoreStorage.urlToId(statusId)}/choices`)
      .get()
    return snapshot.docs.map(
      (item) => new PollChoice(item.data() as PollChoiceData)
    )
  }

  @Trace('db')
  async createPoll({
    id,
    url,
    actorId,
    text,
    summary = '',
    to,
    cc,
    reply = '',
    choices,
    endAt,
    createdAt
  }: CreatePollParams): Promise<Status> {
    const currentTime = Date.now()
    const status = {
      id,
      url,
      actorId,
      type: StatusType.Poll as StatusType.Poll,
      text,
      summary,
      to,
      cc,
      reply,
      endAt,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    }
    const statusPath = `statuses/${FirestoreStorage.urlToId(id)}`
    const choicesData: PollChoiceData[] = choices.map((choice) => ({
      statusId: id,
      title: choice,
      totalVotes: 0,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    }))

    await this.db.doc(statusPath).set(status)
    await Promise.all(
      choices.map((title, index) =>
        this.db
          .doc(`${statusPath}/choices/${this.createMD5(title)}`)
          .set(choicesData[index])
      )
    )

    const actor = await this.getActorFromId({ id: actorId })
    return new Status({
      ...status,
      actor: actor?.toProfile() || null,
      totalLikes: 0,
      isActorLiked: false,
      isActorAnnounced: false,
      edits: [],
      tags: [],
      replies: [],
      choices: choicesData.map((data) => new PollChoice(data).toJson())
    })
  }

  @Trace('db')
  async updatePoll({ statusId, text, summary, choices }: UpdatePollParams) {
    const statusPath = `statuses/${FirestoreStorage.urlToId(statusId)}`
    const snapshot = await this.db.doc(statusPath).get()
    if (!snapshot.exists) return

    const snapshotData = snapshot.data()
    const currentTime = Date.now()
    if (text !== snapshotData?.text || summary !== snapshotData?.summary) {
      const previousData = {
        statusId,
        text: snapshotData?.text,
        ...(snapshotData?.summary ? { summary: snapshotData.summary } : null),
        createdAt: snapshotData?.createdAt,
        updatedAt: currentTime
      }
      const historyPath = `${statusPath}/history/${currentTime}`
      await this.db.doc(historyPath).set(previousData)
      await this.db.doc(statusPath).update({
        text,
        ...(summary ? { summary } : null),
        updatedAt: currentTime
      })
    }
    choices.map(async (choice) => {
      const key = `${statusPath}/choices/${this.createMD5(choice.title)}`
      return this.db.doc(key).update({
        totalVotes: choice.totalVotes,
        updatedAt: currentTime
      })
    })

    return this.getStatus({ statusId })
  }

  private async getEdits(statusId: string) {
    const snapshot = await this.db
      .collection(`statuses/${FirestoreStorage.urlToId(statusId)}/history`)
      .get()
    return snapshot.docs.map((item) => item.data() as Edited)
  }

  @Trace('db')
  private async getStatusFromData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    withReplies: boolean,
    currentActorId?: string
  ): Promise<Status | undefined> {
    if (!data) return

    if (data.type === StatusType.Announce) {
      if (!data.originalStatusId) {
        console.error(
          'Announce status original status id is undefined',
          data.id
        )
        return
      }

      const snapshot = await this.db
        .doc(`statuses/${FirestoreStorage.urlToId(data.originalStatusId)}`)
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
      return new Status({
        id: data.id,
        actorId: data.actorId,
        actor: actor?.toProfile() ?? null,
        type: data.type,

        to: data.to,
        cc: data.cc,
        edits: [],

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
      isActorAnnouncedStatus,
      pollChoices,
      edits
    ] = await Promise.all([
      this.getAttachments({ statusId: data.id }),
      this.getTags({ statusId: data.id }),
      this.getActorFromId({ id: data.actorId }),
      this.getLikeCount({ statusId: data.id }),
      this.isActorLikedStatus(data.id, currentActorId),
      this.hasActorAnnouncedStatus({
        statusId: data.id,
        actorId: currentActorId
      }),
      this.getPollChoices(data.id),
      this.getEdits(data.id)
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
      totalLikes,
      isActorLiked: isActorLikedStatus,
      isActorAnnounced: isActorAnnouncedStatus,
      attachments: attachments.map((attachment) => attachment.toJson()),
      tags: tags.map((tag) => tag.toJson()),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,

      edits,
      ...(data.type === StatusType.Poll
        ? {
            choices: pollChoices.map((choice) => choice.toJson()),
            endAt: data.endAt
          }
        : null)
    })
  }

  @Trace('db')
  private async getStatusWithCurrentActor(
    statusId: string,
    withReplies: boolean,
    currentActorId?: string
  ) {
    const snapshot = await this.db
      .doc(`statuses/${FirestoreStorage.urlToId(statusId)}`)
      .get()
    const data = snapshot.data()
    if (!data) return
    return this.getStatusFromData(data, withReplies, currentActorId)
  }

  async getStatus({ statusId, withReplies = false }: GetStatusParams) {
    return this.getStatusWithCurrentActor(statusId, withReplies)
  }

  async getStatusReplies({ statusId }: GetStatusRepliesParams) {
    return (await this.getReplies(statusId)).map((note) => new Status(note))
  }

  @Trace('db')
  async hasActorAnnouncedStatus({
    actorId,
    statusId
  }: HasActorAnnouncedStatusParams) {
    if (!actorId) return false

    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('originalStatusId', '==', statusId)
      .where('type', '==', 'Announce')
      .where('actorId', '==', actorId)
      .count()
      .get()

    return snapshot.data().count === 1
  }

  @Trace('db')
  async getTimeline({
    timeline,
    actorId,
    startAfterStatusId
  }: GetTimelineParams) {
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
        return statuses
          .filter((status): status is Status => Boolean(status))
          .slice(0, PER_PAGE_LIMIT)
      }
      case Timeline.MAIN:
      case Timeline.NOANNOUNCE: {
        if (!actorId) return []

        let query = this.db
          .collection(`actors/${FirestoreStorage.urlToId(actorId)}/timelines`)
          .where('timeline', '==', timeline)
          .orderBy('createdAt', 'desc')
          .limit(PER_PAGE_LIMIT)
        if (startAfterStatusId) {
          const lastStatus = await this.db
            .collection(`actors/${FirestoreStorage.urlToId(actorId)}/timelines`)
            .where('timeline', '==', timeline)
            .where('statusId', '==', startAfterStatusId)
            .get()
          if (lastStatus.size === 1) {
            query = query.startAfter(lastStatus.docs[0])
          }
        }

        const snapshot = await query.get()
        const statuses = await Promise.all(
          snapshot.docs
            .map((doc) => doc.data().statusId)
            .map(async (statusId) => {
              const statusData = await this.db
                .doc(`statuses/${FirestoreStorage.urlToId(statusId)}`)
                .get()
              return this.getStatusFromData(statusData.data(), false, actorId)
            })
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

  @Trace('db')
  async createTimelineStatus({
    status,
    timeline,
    actorId
  }: CreateTimelineStatusParams): Promise<void> {
    const currentTime = Date.now()
    const path = `actors/${FirestoreStorage.urlToId(
      actorId
    )}/timelines/${timeline}-${FirestoreStorage.urlToId(status.id)}`
    await this.db.doc(path).set({
      timeline,
      statusId: status.id,
      statusActorId: status.actorId,
      createdAt: status.createdAt,
      updatedAt: currentTime
    })
  }

  @Trace('db')
  async getActorStatusesCount({ actorId }: GetActorStatusesCountParams) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .count()
      .get()
    return snapshot.data().count
  }

  @Trace('db')
  async getActorStatuses({ actorId }: GetActorStatusesParams) {
    const statuses = this.db.collection('statuses')
    const snapshot = await statuses
      .where('actorId', '==', actorId)
      .orderBy('createdAt', 'desc')
      .limit(PER_PAGE_LIMIT)
      .get()
    const items = await Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data()
        return this.getStatusFromData(data, false)
      })
    )
    return items.filter((item): item is Status => Boolean(item))
  }

  @Trace('db')
  async deleteStatus({ statusId }: DeleteStatusParams) {
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
      this.db.doc(`statuses/${FirestoreStorage.urlToId(statusId)}`).delete()
    ])
  }

  @Trace('db')
  async createAttachment({
    statusId,
    mediaType,
    url,
    width,
    height,
    name = ''
  }: CreateAttachmentParams): Promise<Attachment> {
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
      .doc(`statuses/${FirestoreStorage.urlToId(statusId)}/attachments/${id}`)
      .set(data)
    return new Attachment(data)
  }

  @Trace('db')
  async getAttachments({ statusId }: GetAttachmentsParams) {
    const snapshot = await this.db
      .collection(`statuses/${FirestoreStorage.urlToId(statusId)}/attachments`)
      .get()
    return snapshot.docs.map(
      (item) => new Attachment(item.data() as AttachmentData)
    )
  }

  @Trace('db')
  async createTag({
    statusId,
    name,
    value,
    type
  }: CreateTagParams): Promise<Tag> {
    const currentTime = Date.now()
    const id = crypto.randomUUID()
    const data: TagData = {
      id,
      statusId,
      type,
      name,
      value: value || '',
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.db
      .doc(`statuses/${FirestoreStorage.urlToId(statusId)}/tags/${id}`)
      .set(data)
    return new Tag(data)
  }

  @Trace('db')
  async getTags({ statusId }: GetTagsParams) {
    const snapshot = await this.db
      .collection(`statuses/${FirestoreStorage.urlToId(statusId)}/tags`)
      .get()
    return snapshot.docs.map((item) => new Tag(item.data() as TagData))
  }

  @Trace('db')
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
        if (!status) return null
        if (status.data.type !== StatusType.Note) return null
        return status.data
      })
    )
    return replies.filter((item): item is StatusNote => Boolean(item))
  }

  @Trace('db')
  async createLike({ actorId, statusId }: CreateLikeParams) {
    const snapshot = await this.db
      .doc(`statuses/${FirestoreStorage.urlToId(statusId)}`)
      .get()
    if (!snapshot.exists) return

    const currentTime = Date.now()
    const isLiked = await this.isActorLikedStatus(statusId, actorId)
    if (isLiked) return

    await this.db
      .doc(
        `statuses/${FirestoreStorage.urlToId(
          statusId
        )}/likes/${FirestoreStorage.urlToId(actorId)}`
      )
      .set({
        actorId,
        statusId,
        createdAt: currentTime,
        updatedAt: currentTime
      })
  }

  @Trace('db')
  async deleteLike({ statusId, actorId }: DeleteLikeParams) {
    await this.db
      .doc(
        `statuses/${FirestoreStorage.urlToId(
          statusId
        )}/likes/${FirestoreStorage.urlToId(actorId)}`
      )
      .delete()
  }

  @Trace('db')
  async getLikeCount({ statusId }: GetLikeCountParams) {
    const countSnapshot = await this.db
      .collection(`statuses/${FirestoreStorage.urlToId(statusId)}/likes`)
      .count()
      .get()
    return countSnapshot.data().count ?? 0
  }

  @Trace('db')
  private async isActorLikedStatus(statusId: string, actorId?: string) {
    if (!actorId) return false
    const snapshot = await this.db
      .doc(
        `statuses/${FirestoreStorage.urlToId(
          statusId
        )}/likes/${FirestoreStorage.urlToId(actorId)}`
      )
      .get()
    return snapshot.exists
  }

  @Trace('db')
  async createMedia({
    actorId,
    original,
    thumbnail,
    description
  }: CreateMediaParams): Promise<Media | null> {
    if (!actorId) return null

    const id = crypto.randomUUID()
    const currentTime = Date.now()
    const media = {
      id,
      actorId,
      original,
      ...(thumbnail ? { thumbnail } : null),
      ...(description ? { description } : null),
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.db.doc(`medias/${id}`).set(media)
    return media
  }
}
