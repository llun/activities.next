import { terminate } from '@firebase/firestore'
import crypto from 'crypto'
import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app'
import {
  Firestore,
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore'

import { deliverTo } from '.'
import { getConfig } from '../config'
import { Account } from '../models/account'
import { Actor } from '../models/actor'
import { Attachment } from '../models/attachment'
import { Follow, FollowStatus } from '../models/follow'
import { Status } from '../models/status'
import {
  CreateAccountParams,
  CreateAttachmentParams,
  CreateFollowParams,
  CreateStatusParams,
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
  GetFollowersHostsParams,
  GetFollowersInboxParams,
  GetLocalFollowersForActorIdParams,
  GetStatusParams,
  GetStatusesParams,
  IsAccountExistsParams,
  IsCurrentActorFollowingParams,
  IsUsernameExistsParams,
  Storage,
  UpdateActorParams,
  UpdateFollowStatusParams
} from './types'

export interface FirebaseConfig extends FirebaseOptions {
  type: 'firebase'
}

export class FirebaseStorage implements Storage {
  app: FirebaseApp
  db: Firestore

  constructor(config: FirebaseConfig) {
    this.app = initializeApp(config)
    this.db = getFirestore(this.app)
  }

  async connectEmulator() {
    connectFirestoreEmulator(this.db, '127.0.0.1', 8080)
  }

  async destroy() {
    await fetch(
      'http://127.0.0.1:8080/emulator/v1/projects/test/databases/(default)/documents',
      {
        method: 'DELETE'
      }
    )
    await terminate(this.db)
  }

  async isAccountExists({ email }: IsAccountExistsParams) {
    if (!email) return true

    const accounts = collection(this.db, 'accounts')
    const query_ = query(accounts, where('email', '==', email))
    const snapshot = await getCountFromServer(query_)
    return snapshot.data().count === 1
  }

  async isUsernameExists({ username }: IsUsernameExistsParams) {
    if (!username) return true

    const accounts = collection(this.db, 'actors')
    const query_ = query(accounts, where('preferredUsername', '==', username))
    const snapshot = await getCountFromServer(query_)
    return snapshot.data().count === 1
  }

  async createAccount({
    email,
    username,
    privateKey,
    publicKey
  }: CreateAccountParams) {
    const config = getConfig()
    const actorId = `https://${config.host}/users/${username}`
    if (await this.isAccountExists({ email })) {
      throw new Error('Account already exists')
    }

    const currentTime = Date.now()
    const accountRef = await addDoc(collection(this.db, 'accounts'), {
      email,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    await addDoc(collection(this.db, 'actors'), {
      id: actorId,
      accountId: accountRef.id,
      preferredUsername: username,
      publicKey,
      privateKey,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    return accountRef.id
  }

  async getAccountFromId({ id }: GetAccountFromIdParams) {
    const accountRef = doc(this.db, 'accounts', id)
    const docSnap = await getDoc(accountRef)
    if (!docSnap.exists()) {
      return undefined
    }

    return {
      ...docSnap.data(),
      id
    } as Account
  }

  async getActorFromEmail({ email }: GetActorFromEmailParams) {
    const accounts = collection(this.db, 'accounts')
    const accountQuery = query(accounts, where('email', '==', email), limit(1))
    const accountsSnapshot = await getDocs(accountQuery)
    if (accountsSnapshot.docs.length !== 1) return undefined

    const accountId = accountsSnapshot.docs[0].id
    const actors = collection(this.db, 'actors')
    const actorsQuery = query(
      actors,
      where('accountId', '==', accountId),
      limit(1)
    )
    const actorsSnapshot = await getDocs(actorsQuery)
    if (actorsSnapshot.docs.length !== 1) return undefined

    const data = actorsSnapshot.docs[0].data()
    const account = await this.getAccountFromId({ id: data.accountId })
    if (!account) return undefined

    return { ...data, account } as Actor
  }

  async getActorFromUsername({ username }: GetActorFromUsernameParams) {
    const actors = collection(this.db, 'actors')
    const actorsQuery = query(
      actors,
      where('preferredUsername', '==', username),
      limit(1)
    )
    const actorsSnapshot = await getDocs(actorsQuery)
    if (actorsSnapshot.docs.length !== 1) return undefined

    const data = actorsSnapshot.docs[0].data()
    const account = await this.getAccountFromId({ id: data.accountId })
    if (!account) return undefined

    return { ...data, account } as Actor
  }

  async getActorFromId({ id }: GetActorFromIdParams) {
    const actors = collection(this.db, 'actors')
    const actorsQuery = query(actors, where('id', '==', id), limit(1))
    const actorsSnapshot = await getDocs(actorsQuery)
    if (actorsSnapshot.docs.length !== 1) return undefined

    const data = actorsSnapshot.docs[0].data()
    const account = await this.getAccountFromId({ id: data.accountId })
    if (!account) return undefined

    return { ...data, account } as Actor
  }

  async updateActor({ actor }: UpdateActorParams) {
    const actors = collection(this.db, 'actors')
    const actorsQuery = query(actors, where('id', '==', actor.id), limit(1))
    const actorsSnapshot = await getDocs(actorsQuery)
    if (actorsSnapshot.docs.length !== 1) return undefined

    const document = actorsSnapshot.docs[0]
    await setDoc(doc(this.db, 'actors', document.id), {
      ...document.data(),
      ...actor
    })

    return actor
  }

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams) {
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('actorId', '==', currentActorId),
      where('targetActorId', '==', followingActorId),
      where('status', '==', FollowStatus.Accepted)
    )
    const snapshot = await getCountFromServer(followsQuery)
    return snapshot.data().count > 0
  }

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('actorId', '==', actorId),
      where('status', '==', FollowStatus.Accepted)
    )
    const snapshot = await getCountFromServer(followsQuery)
    return snapshot.data().count
  }

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('targetActorId', '==', actorId),
      where('status', '==', FollowStatus.Accepted)
    )
    const snapshot = await getCountFromServer(followsQuery)
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
    const followRef = await addDoc(collection(this.db, 'follows'), content)
    return {
      id: followRef.id,
      ...content
    }
  }

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    const docRef = doc(this.db, 'follows', followId)
    const docSnap = await getDoc(docRef)

    if (!docSnap.exists()) {
      return undefined
    }

    const followData = docSnap.data()
    return {
      id: followId,
      actorHost: new URL(followData.actorId).host,
      targetActorHost: new URL(followData.targetActorId).host,
      ...followData
    } as Follow
  }

  async getLocalFollowersForActorId({
    targetActorId
  }: GetLocalFollowersForActorIdParams) {
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('targetActorId', '==', targetActorId),
      where('actorHost', '==', getConfig().host),
      where('status', '==', FollowStatus.Accepted)
    )
    const followsSnapshot = await getDocs(followsQuery)
    return followsSnapshot.docs.map((doc) => doc.data() as Follow)
  }

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams) {
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('actorId', '==', actorId),
      where('targetActorId', '==', targetActorId),
      where('status', 'in', [FollowStatus.Accepted, FollowStatus.Requested]),
      orderBy('createdAt', 'desc'),
      limit(1)
    )
    const followsSnapshot = await getDocs(followsQuery)
    if (followsSnapshot.docs.length !== 1) return undefined

    const followData = followsSnapshot.docs[0].data()
    return {
      id: followsSnapshot.docs[0].id,
      actorHost: new URL(followData.actorId).host,
      targetActorHost: new URL(followData.targetActorId).host,
      ...followData
    } as Follow
  }

  async getFollowersHosts({ targetActorId }: GetFollowersHostsParams) {
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('targetActorId', '==', targetActorId),
      where('status', '==', FollowStatus.Accepted)
    )
    const followsSnapshot = await getDocs(followsQuery)
    const hosts: Set<string> = new Set()
    followsSnapshot.forEach((doc) =>
      hosts.add(new URL(doc.data().actorId).host)
    )
    return Array.from(hosts)
  }

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('targetActorId', '==', targetActorId),
      where('status', '==', FollowStatus.Accepted)
    )
    const snapshot = await getDocs(followsQuery)
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
    if (!follow) {
      return
    }

    const follwRef = doc(this.db, 'follows', follow.id)
    await updateDoc(follwRef, {
      status,
      updatedAt: Date.now()
    })
  }

  async createStatus({
    id,
    url,
    actorId,
    type,
    text,
    summary = '',
    to,
    cc,
    reply = '',
    createdAt
  }: CreateStatusParams) {
    const currentTime = Date.now()
    const local = await deliverTo({ from: actorId, to, cc, storage: this })
    const status = {
      id,
      url,
      actorId,
      type,
      text,
      summary,
      to,
      cc,
      localRecipients: local,
      reply,
      createdAt: createdAt || currentTime,
      updatedAt: currentTime
    } as any
    await addDoc(collection(this.db, 'statuses'), status)
    return new Status({
      ...status,
      attachments: []
    })
  }

  async getStatusFromData(data: any): Promise<Status> {
    const attachments = await this.getAttachments({ statusId: data.id })
    return new Status({
      id: data.id,
      url: data.url,
      to: data.to,
      cc: data.cc,
      actorId: data.actorId,
      type: data.type,
      text: data.text,
      summary: data.summary,
      reply: data.reply,
      attachments,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    })
  }

  async getStatus({ statusId }: GetStatusParams) {
    const statuses = collection(this.db, 'statuses')
    const statusesQuery = query(statuses, where('id', '==', statusId), limit(1))
    const statusesSnapshot = await getDocs(statusesQuery)
    if (statusesSnapshot.docs.length !== 1) return undefined

    const data = statusesSnapshot.docs[0].data()
    return this.getStatusFromData(data)
  }

  async getStatuses({ actorId }: GetStatusesParams) {
    const statuses = collection(this.db, 'statuses')
    const statusesQuery = query(
      statuses,
      where('localRecipients', 'array-contains', actorId),
      orderBy('createdAt', 'desc'),
      limit(30)
    )
    const statusesSnapshot = await getDocs(statusesQuery)
    return Promise.all(
      statusesSnapshot.docs.map((item) => {
        const data = item.data()
        return this.getStatusFromData(data)
      })
    )
  }

  async getActorStatusesCount({ actorId }: GetActorStatusesCountParams) {
    const statuses = collection(this.db, 'statuses')
    const statusesQuery = query(statuses, where('actorId', '==', actorId))
    const snapshot = await getCountFromServer(statusesQuery)
    return snapshot.data().count
  }

  async getActorStatuses({ actorId }: GetActorStatusesParams) {
    const statuses = collection(this.db, 'statuses')
    const statusesQuery = query(
      statuses,
      where('actorId', '==', actorId),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    const snapshot = await getDocs(statusesQuery)
    return Promise.all(
      snapshot.docs.map((item) => {
        const data = item.data()
        return this.getStatusFromData(data)
      })
    )
  }

  async deleteStatus({ statusId }: DeleteStatusParams) {
    const statuses = collection(this.db, 'statuses')
    const statusesQuery = query(statuses, where('id', '==', statusId), limit(1))
    const statusesSnapshot = await getDocs(statusesQuery)
    if (statusesSnapshot.docs.length !== 1) return

    const document = statusesSnapshot.docs[0]
    await deleteDoc(doc(this.db, 'statuses', document.id))
  }

  async createAttachment({
    statusId,
    mediaType,
    url,
    width,
    height,
    name = ''
  }: CreateAttachmentParams): Promise<Attachment> {
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      statusId,
      type: 'Document',
      mediaType,
      url,
      width,
      height,
      name,

      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await addDoc(collection(this.db, 'attachments'), attachment)
    return attachment
  }

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const attachments = collection(this.db, 'attachments')
    const attachmentsQuery = query(
      attachments,
      where('statusId', '==', statusId)
    )
    const snapshot = await getDocs(attachmentsQuery)
    return snapshot.docs.map((item) => item.data() as Attachment)
  }
}
