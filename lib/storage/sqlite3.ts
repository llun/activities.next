import { knex, Knex } from 'knex'
import crypto from 'crypto'
import { Status } from '../models/status'
import { Actor } from '../models/actor'
import { getConfig } from '../config'
import { Follow } from '../models/follow'

export class Sqlite3Storage {
  database: Knex

  constructor(config: Knex.Config) {
    this.database = knex(config)
  }

  async isAccountExists(email?: string | null) {
    if (!email) return false
    const result = await this.database('accounts')
      .where('email', email)
      .count('id as count')
      .first()
    return Boolean(result?.count && result?.count > 0)
  }

  async isUsernameExists(username: string) {
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

  async getActorFromEmail(email: string) {
    return this.database('actors')
      .select<Actor>('actors.*')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first()
  }

  async isCurrentActorFollowing(
    currentActorId: string,
    followingActorId: string
  ) {
    const result = await this.database('actors')
      .where('followingId', followingActorId)
      .andWhere('id', currentActorId)
      .count('id as count')
      .first()
    return Boolean(result?.count && result?.count > 0)
  }

  async getActorFromUsername(username: string) {
    return this.database<Actor>('actors')
      .where('preferredUsername', username)
      .first()
  }

  async createFollow(actor: Actor, targetActorId: string) {
    const currentTime = Date.now()
    const follow: Follow = {
      id: crypto.randomUUID(),
      actor,
      targetActorId,
      status: 'Requested',
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.database('follows').insert({
      ...follow,
      actorId: actor.id
    })
    return follow
  }

  async getFollowFromId(id: string, actorId: string) {
    const [follow, actor] = await Promise.all([
      this.database('follows').where('id', id).first(),
      this.database('actors').where('id', id).first()
    ])
    if (follow.actorId !== actorId) {
      return null
    }
    return {
      ...follow,
      actor
    } as Follow
  }

  async updateFollowStatus(
    id: string,
    status: 'Requested' | 'Accepted' | 'Rejected'
  ) {
    await this.database('follows').where('id', id).update({
      status,
      updatedAt: Date.now()
    })
  }

  async createStatus(status: Status) {
    const { account, mediaAttachmentIds, ...rest } = status
    await this.database.insert(rest).into('statuses')
  }

  async getStatuses() {
    return this.database<Status>('statuses')
      .select('*')
      .orderBy('createdAt', 'desc')
  }
}
