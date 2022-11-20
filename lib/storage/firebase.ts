import crypto from 'crypto'
import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app'
import {
  getFirestore,
  Firestore,
  collection,
  addDoc,
  getCountFromServer,
  query,
  where,
  getDocs,
  limit,
  doc,
  getDoc,
  updateDoc,
  orderBy
} from 'firebase/firestore'

import { Storage } from './types'
import { Status } from '../models/status'
import { Follow, FollowStatus } from '../models/follow'
import { Actor } from '../models/actor'

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

  async isAccountExists(params: { email?: string | null }) {
    const { email } = params
    if (!email) return true

    const accounts = collection(this.db, 'accounts')
    const query_ = query(accounts, where('email', '==', email))
    const snapshot = await getCountFromServer(query_)
    return snapshot.data().count === 1
  }

  async isUsernameExists(params: { username: string }) {
    const { username } = params
    if (!username) return true

    const accounts = collection(this.db, 'actors')
    const query_ = query(accounts, where('preferredUsername', '==', username))
    const snapshot = await getCountFromServer(query_)
    return snapshot.data().count === 1
  }

  async createAccount(params: {
    email: string
    username: string
    privateKey: string
    publicKey: string
  }) {
    const { email, username, privateKey, publicKey } = params
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
      accountId: accountRef.id,
      preferredUsername: username,
      publicKey,
      privateKey,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    return accountRef.id
  }

  async getActorFromEmail(params: { email: string }) {
    const { email } = params
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

    const actorData = actorsSnapshot.docs[0].data()
    return {
      id: actorsSnapshot.docs[0].id,
      ...actorData
    } as Actor
  }

  async getActorFromUsername(params: { username: string }) {
    const { username } = params
    const actors = collection(this.db, 'actors')
    const actorsQuery = query(
      actors,
      where('preferredUsername', '==', username),
      limit(1)
    )
    const actorsSnapshot = await getDocs(actorsQuery)
    if (actorsSnapshot.docs.length !== 1) return undefined

    const actorData = actorsSnapshot.docs[0].data()
    return {
      id: actorsSnapshot.docs[0].id,
      ...actorData
    } as Actor
  }

  async getActorFromId(params: { id: string }) {
    const { id } = params
    const docRef = doc(this.db, 'actors', id)
    const docSnap = await getDoc(docRef)

    if (!docSnap.exists()) {
      return undefined
    }

    const actorData = docSnap.data()
    return {
      id,
      ...actorData
    } as Actor
  }

  async isCurrentActorFollowing(params: {
    currentActorId: string
    followingActorId: string
  }) {
    return false
  }

  async getActorFollowingCount(params: { actorId: string }) {
    const { actorId } = params
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('actorId', '==', actorId),
      where('status', '==', FollowStatus.Accepted)
    )
    const snapshot = await getCountFromServer(followsQuery)
    return snapshot.data().count
  }

  async getActorFollowersCount(params: { actorId: string }) {
    const { actorId } = params
    const follows = collection(this.db, 'follows')
    const followsQuery = query(
      follows,
      where('targetActorId', '==', actorId),
      where('status', '==', FollowStatus.Accepted)
    )
    const snapshot = await getCountFromServer(followsQuery)
    return snapshot.data().count
  }

  async createFollow(params: {
    actorId: string
    targetActorId: string
    status: FollowStatus
  }) {
    const { actorId, targetActorId, status } = params
    const currentTime = Date.now()
    const content = {
      actorId: actorId,
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

  async getFollowFromId(params: { followId: string }) {
    const { followId } = params
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

  async getAcceptedOrRequestedFollow(params: {
    actorId: string
    targetActorId: string
  }) {
    const { actorId, targetActorId } = params
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

  async getFollowersHosts(params: { targetActorId: string }) {
    const { targetActorId } = params
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

  async updateFollowStatus(params: { followId: string; status: FollowStatus }) {
    const { followId, status } = params
    const follow = await this.getFollowFromId({ followId })
    if (!follow) {
      return
    }

    const follwRef = doc(this.db, 'follows', follow.id)
    await updateDoc(follwRef, {
      status
    })
  }

  async createStatus(params: { status: Status }) {
    const { status } = params
    return status
  }

  async getStatuses(params?: { actorId?: string }) {
    return []
  }

  async getActorStatusesCount(params: { actorId: string }) {
    return 0
  }
}
