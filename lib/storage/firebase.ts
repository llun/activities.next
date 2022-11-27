import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app'
import {
  Firestore,
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  updateDoc,
  where
} from 'firebase/firestore'

import { getConfig } from '../config'
import { Actor } from '../models/actor'
import { Attachment } from '../models/attachment'
import { Follow, FollowStatus } from '../models/follow'
import { Status } from '../models/status'
import {
  CreateAccountParams,
  CreateAttachmentParams,
  CreateFollowParams,
  CreateStatusParams,
  GetAcceptedOrRequestedFollowParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetFollowFromIdParams,
  GetFollowersHostsParams,
  IsAccountExistsParams,
  IsCurrentActorFollowingParams,
  IsUsernameExistsParams,
  Storage,
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

    return actorsSnapshot.docs[0].data() as Actor
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

    return actorsSnapshot.docs[0].data() as Actor
  }

  async getActorFromId({ id }: GetActorFromIdParams) {
    const actors = collection(this.db, 'actors')
    const actorsQuery = query(actors, where('id', '==', id), limit(1))
    const actorsSnapshot = await getDocs(actorsQuery)
    if (actorsSnapshot.docs.length !== 1) return undefined

    return actorsSnapshot.docs[0].data() as Actor
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

  async createFollow({ actorId, targetActorId, status }: CreateFollowParams) {
    const currentTime = Date.now()
    const content = {
      actorId,
      targetActorId,
      status,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    const followRef = await addDoc(collection(this.db, 'follows'), content)
    return {
      id: followRef.id,
      actorHost: new URL(actorId).host,
      targetActorHost: new URL(targetActorId).host,
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

  async updateFollowStatus({ followId, status }: UpdateFollowStatusParams) {
    const follow = await this.getFollowFromId({ followId })
    if (!follow) {
      return
    }

    const follwRef = doc(this.db, 'follows', follow.id)
    await updateDoc(follwRef, {
      status
    })
  }

  async createStatus({ status }: CreateStatusParams) {
    await addDoc(collection(this.db, 'statuses'), status)
    return status
  }

  async getStatuses() {
    const statuses = collection(this.db, 'statuses')
    const statusesQuery = query(
      statuses,
      orderBy('createdAt', 'desc'),
      limit(50)
    )
    const statusesSnapshot = await getDocs(statusesQuery)
    return statusesSnapshot.docs.map((item) => item.data() as Status)
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
    return snapshot.docs.map((item) => item.data() as Status)
  }

  async createAttachment({
    statusId,
    mediaType,
    url,
    width,
    height,
    name
  }: CreateAttachmentParams): Promise<Attachment> {
    const attachment: Attachment = {
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
    return attachment
  }

  async getAttachments() {
    return []
  }
}
