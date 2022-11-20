import crypto from 'crypto'
import { FirebaseApp, FirebaseOptions, initializeApp } from 'firebase/app'
import {
  getFirestore,
  Firestore,
  collection,
  addDoc,
  getCountFromServer,
  query,
  where
} from 'firebase/firestore'

import { Storage } from './types'
import { Status } from '../models/status'
import { Follow, FollowStatus } from '../models/follow'

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
    return undefined
  }

  async isCurrentActorFollowing(params: {
    currentActorId: string
    followingActorId: string
  }) {
    return false
  }

  async getActorFromUsername(params: { username: string }) {
    return undefined
  }

  async getActorFromId(params: { id: string }) {
    return undefined
  }

  async getActorFollowingCount(params: { actorId: string }) {
    return 0
  }

  async getActorFollowersCount(params: { actorId: string }) {
    return 0
  }

  async createFollow(params: {
    actorId: string
    targetActorId: string
    status: FollowStatus
  }) {
    const { actorId, targetActorId, status } = params
    const currentTime = Date.now()
    const follow: Follow = {
      id: crypto.randomUUID(),
      actorId: actorId,
      actorHost: new URL(actorId).host,
      targetActorId,
      targetActorHost: new URL(targetActorId).host,
      status,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    return follow
  }

  async getFollowFromId(params: { followId: string }) {
    return undefined
  }

  async getAcceptedOrRequestedFollow(params: {
    actorId: string
    targetActorId: string
  }) {
    return undefined
  }

  async getFollowersHosts(params: { targetActorId: string }) {
    return []
  }

  async updateFollowStatus(params: {
    followId: string
    status: FollowStatus
  }) {}

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
