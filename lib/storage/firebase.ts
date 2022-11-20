import crypto from 'crypto'
import { FirebaseApp, initializeApp } from 'firebase/app'
import { getFirestore, Firestore } from 'firebase/firestore/lite'

import { Storage } from './types'
import { Status } from '../models/status'
import { Follow, FollowStatus } from '../models/follow'

export interface FirebaseConfig {
  type: 'firebase'
  apiKey: string
}

export class FirebaseStorage implements Storage {
  app: FirebaseApp
  db: Firestore

  constructor(config: FirebaseConfig) {
    this.app = initializeApp({
      apiKey: config.apiKey
    })
    this.db = getFirestore(this.app)
  }

  async isAccountExists(params: { email?: string | null }) {
    return false
  }

  async isUsernameExists(params: { username: string }) {
    return false
  }

  async createAccount(params: {
    email: string
    username: string
    privateKey: string
    publicKey: string
  }) {
    return ''
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
