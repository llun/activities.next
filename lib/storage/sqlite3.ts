import crypto from 'crypto'
import { Knex, knex } from 'knex'

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

export class Sqlite3Storage implements Storage {
  database: Knex

  constructor(config: Knex.Config) {
    this.database = knex(config)
  }

  async isAccountExists({ email }: IsAccountExistsParams) {
    if (!email) return false
    const result = await this.database('accounts')
      .where('email', email)
      .count('id as count')
      .first()
    return Boolean(result?.count && result?.count > 0)
  }

  async isUsernameExists({ username }: IsUsernameExistsParams) {
    const response = await this.database('actors')
      .where('preferredUsername', username)
      .count('id as count')
      .first()
    return Boolean(response?.count && response?.count > 0)
  }

  async createAccount({
    email,
    username,
    privateKey,
    publicKey
  }: CreateAccountParams) {
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

  async getActorFromEmail({ email }: GetActorFromEmailParams) {
    return this.database('actors')
      .select<Actor>('actors.*')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first()
  }

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams) {
    const result = await this.database('follows')
      .where('actorId', currentActorId)
      .andWhere('targetActorId', followingActorId)
      .andWhere('status', 'Accepted')
      .count('id as count')
      .first()
    return Boolean(result?.count && result?.count > 0)
  }

  async getActorFromUsername({ username }: GetActorFromUsernameParams) {
    return this.database<Actor>('actors')
      .where('preferredUsername', username)
      .first()
  }

  async getActorFromId({ id }: GetActorFromIdParams) {
    return this.database<Actor>('actors').where('id', id).first()
  }

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    const result = await this.database('follows')
      .where('actorId', actorId)
      .andWhere('status', 'Accepted')
      .count('* as count')
      .first()
    return (result?.count as number) || 0
  }

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    const result = await this.database('follows')
      .where('targetActorId', actorId)
      .andWhere('status', 'Accepted')
      .count('* as count')
      .first()
    return (result?.count as number) || 0
  }

  async createFollow({ actorId, targetActorId, status }: CreateFollowParams) {
    const currentTime = Date.now()
    const follow: Follow = {
      id: crypto.randomUUID(),
      actorId,
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

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    return this.database<Follow>('follows').where('id', followId).first()
  }

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams) {
    return this.database<Follow>('follows')
      .where('actorId', actorId)
      .where('targetActorId', targetActorId)
      .whereIn('status', [FollowStatus.Accepted, FollowStatus.Requested])
      .orderBy('createdAt', 'desc')
      .first()
  }

  async getFollowersHosts({ targetActorId }: GetFollowersHostsParams) {
    const hosts = await this.database<Follow>('follows')
      .select('actorHost')
      .where('targetActorId', targetActorId)
      .where('status', FollowStatus.Accepted)
      .distinct()
    return hosts.map((item) => item.actorHost)
  }

  async updateFollowStatus({ followId, status }: UpdateFollowStatusParams) {
    await this.database('follows').where('id', followId).update({
      status,
      updatedAt: Date.now()
    })
  }

  async createStatus({ status }: CreateStatusParams) {
    const { to, cc, ...rest } = status
    await this.database.transaction(async (trx) => {
      await trx('statuses').insert(rest)
    })

    return { ...status, to, cc }
  }

  async getStatuses() {
    return this.database<Status>('statuses')
      .select('*')
      .orderBy('createdAt', 'desc')
      .limit(20)
  }

  async getActorStatusesCount({ actorId }: GetActorStatusesCountParams) {
    const result = await this.database('statuses')
      .where('actorId', actorId)
      .count<{ count: number }>('* as count')
      .first()
    return result?.count || 0
  }

  async getActorStatuses({ actorId }: GetActorStatusesParams) {
    return this.database<Status>('statuses')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .limit(20)
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
    return attachment
  }

  async getAttachments() {
    return []
  }
}
