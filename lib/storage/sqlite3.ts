import crypto from 'crypto'
import { Knex, knex } from 'knex'

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

interface ActorSettings {
  iconUrl?: string
  headerImageUrl?: string
  appleSharedAlbumToken?: string
}

interface SQLActor {
  id: string
  preferredUsername: string
  name?: string
  summary?: string
  accountId: string

  publicKey: string
  privateKey: string

  settings: string

  createdAt: number
  updatedAt: number
}

export class Sqlite3Storage implements Storage {
  database: Knex

  constructor(config: Knex.Config) {
    this.database = knex(config)
  }

  async migrate() {
    await this.database.migrate.latest()
  }

  async destroy() {
    await this.database.destroy()
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

  async getAccountFromId({ id }: GetAccountFromIdParams) {
    return this.database<Account>('accounts').where('id', id).first()
  }

  private getActor(sqlActor: SQLActor, account: Account) {
    const settings = JSON.parse(sqlActor.settings || '{}') as ActorSettings
    const actor: Actor = {
      id: sqlActor.id,
      preferredUsername: sqlActor.preferredUsername || '',
      name: sqlActor.name || '',
      summary: sqlActor.summary || '',

      account,

      iconUrl: settings.iconUrl || '',
      headerImageUrl: settings.headerImageUrl || '',
      appleSharedAlbumToken: settings.appleSharedAlbumToken || '',

      publicKey: sqlActor.publicKey || '',
      privateKey: sqlActor.privateKey || '',

      createdAt: sqlActor.createdAt,
      updatedAt: sqlActor.updatedAt
    }
    return actor
  }

  async getActorFromEmail({ email }: GetActorFromEmailParams) {
    const storageActor = await this.database('actors')
      .select<SQLActor>('actors.*')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first()
    if (!storageActor) return undefined

    const account = await this.getAccountFromId({ id: storageActor.accountId })
    if (!account) return undefined
    return this.getActor(storageActor, account)
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
    const storageActor = await this.database<SQLActor>('actors')
      .where('preferredUsername', username)
      .first()
    if (!storageActor) return undefined

    const account = await this.getAccountFromId({ id: storageActor.accountId })
    if (!account) return undefined
    return this.getActor(storageActor, account)
  }

  async getActorFromId({ id }: GetActorFromIdParams) {
    const storageActor = await this.database<SQLActor>('actors')
      .where('id', id)
      .first()
    if (!storageActor) return undefined

    const account = await this.getAccountFromId({ id: storageActor.accountId })
    if (!account) return undefined
    return this.getActor(storageActor, account)
  }

  async updateActor({ actor }: UpdateActorParams) {
    const storageActor = await this.database<SQLActor>('actors')
      .where('id', actor.id)
      .first()
    if (!storageActor) return undefined

    const settings: ActorSettings = {
      iconUrl: actor.iconUrl,
      headerImageUrl: actor.headerImageUrl,
      appleSharedAlbumToken: actor.appleSharedAlbumToken
    }

    await this.database<SQLActor>('actors').update({
      name: actor.name,
      summary: actor.summary,
      settings: JSON.stringify(settings),
      updatedAt: Date.now()
    })

    return actor
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
    const follow: Follow = {
      id: crypto.randomUUID(),
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
    await this.database('follows').insert({ ...follow, inbox, sharedInbox })
    return follow
  }

  async getFollowFromId({ followId }: GetFollowFromIdParams) {
    return this.database<Follow>('follows').where('id', followId).first()
  }

  async getLocalFollowersForActorId({
    targetActorId
  }: GetLocalFollowersForActorIdParams) {
    return this.database<Follow>('follows')
      .where('targetActorId', targetActorId)
      .where('actorHost', getConfig().host)
      .whereIn('status', [FollowStatus.Accepted])
      .orderBy('createdAt', 'desc')
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

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    const follows = await this.database<Follow>('follows')
      .where('targetActorId', targetActorId)
      .where('status', FollowStatus.Accepted)
    return Array.from(
      follows.reduce((inboxes, follow) => {
        if (follow.sharedInbox) inboxes.add(follow.sharedInbox)
        else inboxes.add(follow.inbox)
        return inboxes
      }, new Set<string>())
    )
  }

  async updateFollowStatus({ followId, status }: UpdateFollowStatusParams) {
    await this.database('follows').where('id', followId).update({
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
    localRecipients = [],
    reply = '',
    createdAt
  }: CreateStatusParams) {
    const currentTime = Date.now()
    const statusCreatedAt = createdAt || currentTime
    const statusUpdatedAt = currentTime

    await this.database.transaction(async (trx) => {
      await trx<Status>('statuses').insert({
        id,
        url,
        actorId,
        type,
        text,
        summary,
        reply,
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
      })
      await Promise.all(
        to.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'to',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )

      await Promise.all(
        cc.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'cc',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )

      await Promise.all(
        localRecipients.map((actorId) =>
          trx('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId,
            type: 'local',

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )
    })

    return {
      id,
      url,
      actorId,
      type,
      text,
      summary,
      reply,
      to,
      cc,
      attachments: [],
      localRecipients,
      createdAt: statusCreatedAt,
      updatedAt: statusUpdatedAt
    }
  }

  async getStatusWithAttachmentsFromData(data: any): Promise<Status> {
    const [attachments, to, cc, local] = await Promise.all([
      this.getAttachments({ statusId: data.id }),
      this.database('recipients')
        .where('statusId', data.id)
        .andWhere('type', 'to'),
      this.database('recipients')
        .where('statusId', data.id)
        .andWhere('type', 'cc'),
      this.database('recipients')
        .where('statusId', data.id)
        .andWhere('type', 'local')
    ])

    return {
      id: data.id,
      url: data.url,
      to: to.map((item) => item.actorId),
      cc: cc.map((item) => item.actorId),
      localRecipients: local.map((item) => item.actorId),
      actorId: data.actorId,
      type: data.type,
      text: data.text,
      summary: data.summary,
      reply: data.reply,
      attachments,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    }
  }

  async getStatus({ statusId }: GetStatusParams) {
    const status = await this.database<Status>('statuses')
      .where('id', statusId)
      .first()
    if (!status) return undefined
    return this.getStatusWithAttachmentsFromData(status)
  }

  async getStatuses({ actorId }: GetStatusesParams) {
    const postsPerPage = 30
    const local = await this.database('recipients')
      .where('type', 'local')
      .andWhere('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .limit(postsPerPage)

    const statuses = await this.database<Status>('statuses')
      .whereIn(
        'id',
        local.map((item) => item.statusId)
      )
      .orderBy('createdAt', 'desc')
      .limit(postsPerPage)

    return Promise.all(
      statuses.map(async (item) => this.getStatusWithAttachmentsFromData(item))
    )
  }

  async getActorStatusesCount({ actorId }: GetActorStatusesCountParams) {
    const result = await this.database('statuses')
      .where('actorId', actorId)
      .count<{ count: number }>('* as count')
      .first()
    return result?.count || 0
  }

  async getActorStatuses({ actorId }: GetActorStatusesParams) {
    const statuses = await this.database<Status>('statuses')
      .where('actorId', actorId)
      .orderBy('createdAt', 'desc')
      .limit(20)

    return Promise.all(
      statuses.map(async (item) => {
        const attachments = await this.getAttachments({ statusId: item.id })
        return {
          ...item,
          attachments
        }
      })
    )
  }

  async deleteStatus({ statusId }: DeleteStatusParams) {
    await this.database<Status>('statuses').where('id', statusId).delete()
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
    await this.database('attachments').insert(attachment)
    return attachment
  }

  async getAttachments({ statusId }: GetAttachmentsParams) {
    return this.database<Attachment>('attachments').where('statusId', statusId)
  }
}
