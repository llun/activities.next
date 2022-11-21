import { knex, Knex } from 'knex'
import crypto from 'crypto'

import { Storage } from './types'

import { Status } from '../models/status'
import { Actor } from '../models/actor'
import { getConfig } from '../config'
import { Follow, FollowStatus } from '../models/follow'

export class Sqlite3Storage implements Storage {
  database: Knex

  constructor(config: Knex.Config) {
    this.database = knex(config)
  }

  async isAccountExists(params: { email?: string | null }) {
    const { email } = params
    if (!email) return false
    const result = await this.database('accounts')
      .where('email', email)
      .count('id as count')
      .first()
    return Boolean(result?.count && result?.count > 0)
  }

  async isUsernameExists(params: { username: string }) {
    const { username } = params
    const response = await this.database('actors')
      .where('preferredUsername', username)
      .count('id as count')
      .first()
    return Boolean(response?.count && response?.count > 0)
  }

  async createAccount(params: {
    email: string
    username: string
    privateKey: string
    publicKey: string
  }) {
    const { email, username, privateKey, publicKey } = params
    const config = getConfig()
    const accountId = crypto.randomUUID()
    const actorId = `https://${config.host}/users/${username}`
    const currentTime = Date.now()
    await this.database.transaction(async (trx) => {
      await trx('accounts').insert({
        id: accountId,
        email,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      await trx('actors').insert({
        id: actorId,
        accountId,
        preferredUsername: username,
        publicKey,
        privateKey,
        createdAt: currentTime,
        updatedAt: currentTime
      })
    })

    return accountId
  }

  async getActorFromEmail(params: { email: string }) {
    const { email } = params
    return this.database('actors')
      .select<Actor>('actors.*')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first()
  }

  async isCurrentActorFollowing(params: {
    currentActorId: string
    followingActorId: string
  }) {
    const { currentActorId, followingActorId } = params
    const result = await this.database('follows')
      .where('actorId', currentActorId)
      .andWhere('targetActorId', followingActorId)
      .andWhere('status', 'Accepted')
      .count('id as count')
      .first()
    return Boolean(result?.count && result?.count > 0)
  }

  async getActorFromUsername(params: { username: string }) {
    const { username } = params
    return this.database<Actor>('actors')
      .where('preferredUsername', username)
      .first()
  }

  async getActorFromId(params: { id: string }) {
    const { id } = params
    return this.database<Actor>('actors').where('id', id).first()
  }

  async getActorFollowingCount(params: { actorId: string }) {
    const { actorId } = params
    const result = await this.database('follows')
      .where('actorId', actorId)
      .andWhere('status', 'Accepted')
      .count('* as count')
      .first()
    return (result?.count as number) || 0
  }

  async getActorFollowersCount(params: { actorId: string }) {
    const { actorId } = params
    const result = await this.database('follows')
      .where('targetActorId', actorId)
      .andWhere('status', 'Accepted')
      .count('* as count')
      .first()
    return (result?.count as number) || 0
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
    await this.database('follows').insert(follow)
    return follow
  }

  async getFollowFromId(params: { followId: string }) {
    const { followId } = params
    return this.database<Follow>('follows').where('id', followId).first()
  }

  async getAcceptedOrRequestedFollow(params: {
    actorId: string
    targetActorId: string
  }) {
    const { actorId, targetActorId } = params
    return this.database<Follow>('follows')
      .where('actorId', actorId)
      .where('targetActorId', targetActorId)
      .whereIn('status', [FollowStatus.Accepted, FollowStatus.Requested])
      .orderBy('createdAt', 'desc')
      .first()
  }

  async getFollowersHosts(params: { targetActorId: string }) {
    const { targetActorId } = params
    const hosts = await this.database<Follow>('follows')
      .select('actorHost')
      .where('targetActorId', targetActorId)
      .where('status', FollowStatus.Accepted)
      .distinct()
    return hosts.map((item) => item.actorHost)
  }

  async updateFollowStatus(params: { followId: string; status: FollowStatus }) {
    const { followId, status } = params
    await this.database('follows').where('id', followId).update({
      status,
      updatedAt: Date.now()
    })
  }

  async createStatus(params: { status: Status }) {
    const { status } = params
    const { mediaAttachmentIds, to, cc, ...rest } = status
    await this.database.transaction(async (trx) => {
      await trx('statuses').insert(rest)
      for (const item of to) {
        await trx('statusDeliveries').insert({
          statusId: rest.id,
          to: item
        })
      }
      for (const item of cc) {
        await trx('statusDeliveries').insert({
          statusId: rest.id,
          to: item
        })
      }
    })

    return { ...status, to, cc }
  }

  async getStatuses(params?: { actorId?: string }) {
    return this.database<Status>('statuses')
      .select('*')
      .orderBy('createdAt', 'desc')
  }

  async getActorStatusesCount(params: { actorId: string }) {
    const { actorId } = params
    const result = await this.database('statuses')
      .where('actorId', actorId)
      .count<{ count: number }>('* as count')
      .first()
    return result?.count || 0
  }

  async getActorStatuses(params: { actorId: string }) {
    const { actorId } = params
    return this.database<Status>('statuses')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .limit(20)
  }
}
