import crypto from 'crypto'
import { Knex, knex } from 'knex'

import { deliverTo } from '.'
import { getConfig } from '../config'
import { Account } from '../models/account'
import { Actor } from '../models/actor'
import { Attachment, AttachmentData } from '../models/attachment'
import { Follow, FollowStatus } from '../models/follow'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '../models/status'
import { Tag, TagData } from '../models/tag'
import {
  CreateAccountParams,
  CreateAnnounceParams,
  CreateAttachmentParams,
  CreateFollowParams,
  CreateNoteParams,
  CreateTagParams,
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
  GetTagsParams,
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
  username: string
  domain: string
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

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    const response = await this.database('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .count('id as count')
      .first()
    return Boolean(response?.count && response?.count > 0)
  }

  async createAccount({
    email,
    username,
    domain,
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
        username,
        domain,
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
      username: sqlActor.username,
      domain: sqlActor.domain,
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
      .where('username', username)
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
    const statusCreatedAt = createdAt || currentTime
    const statusUpdatedAt = currentTime

    const local = await deliverTo({ from: actorId, to, cc, storage: this })
    await this.database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        actorId,
        type: StatusType.Note,
        content: JSON.stringify({
          url,
          text,
          summary
        }),
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
        local.map((actorId) =>
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

    return new Status({
      id,
      url,
      actorId,
      type: StatusType.Note,
      text,
      summary,
      reply,
      to,
      cc,
      attachments: [],
      tags: [],
      replies: [],
      createdAt: statusCreatedAt,
      updatedAt: statusUpdatedAt
    })
  }

  async createAnnounce({
    id,
    actorId,
    to,
    cc,
    originalStatusId,
    createdAt
  }: CreateAnnounceParams) {
    const currentTime = Date.now()
    const statusCreatedAt = createdAt || currentTime
    const statusUpdatedAt = currentTime

    const local = await deliverTo({ from: actorId, to, cc, storage: this })
    await this.database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        actorId,
        type: StatusType.Announce,
        reply: '',
        content: originalStatusId,
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
        local.map((actorId) =>
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

    const originalStatus = await this.getStatus({ statusId: originalStatusId })
    const announceData: StatusAnnounce = {
      id,
      actorId,
      to,
      cc,
      type: StatusType.Announce,
      originalStatus: originalStatus?.data as StatusNote,

      createdAt: statusUpdatedAt,
      updatedAt: statusUpdatedAt
    }

    return new Status(announceData)
  }

  async getStatusWithAttachmentsFromData(data: any): Promise<Status> {
    const [to, cc] = await Promise.all([
      this.database('recipients')
        .where('statusId', data.id)
        .andWhere('type', 'to'),
      this.database('recipients')
        .where('statusId', data.id)
        .andWhere('type', 'cc')
    ])

    if (data.type === StatusType.Announce) {
      const originalStatusId = data.content
      const originalStatus = await this.getStatus({
        statusId: originalStatusId
      })
      const announceData: StatusAnnounce = {
        id: data.id,
        actorId: data.actorId,
        type: StatusType.Announce,
        to: to.map((item) => item.actorId),
        cc: cc.map((item) => item.actorId),
        originalStatus: originalStatus?.data as StatusNote,

        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      }

      return new Status(announceData)
    }

    const [attachments, tags, replies] = await Promise.all([
      this.getAttachments({ statusId: data.id }),
      this.getTags({ statusId: data.id }),
      this.database('statuses')
        .select('id')
        .where('reply', data.id)
        .orderBy('createdAt', 'desc')
    ])

    const repliesNote = (
      await Promise.all(
        replies.map((item) => this.getStatus({ statusId: item.id }))
      )
    )
      .map((item) => (item?.data.type === StatusType.Note ? item.data : null))
      .filter((item): item is StatusNote => Boolean(item))

    const content = JSON.parse(data.content)

    return new Status({
      id: data.id,
      url: content.url,
      to: to.map((item) => item.actorId),
      cc: cc.map((item) => item.actorId),
      actorId: data.actorId,
      type: StatusType.Note,
      text: content.text,
      summary: content.summary,
      reply: data.reply,
      replies: repliesNote,
      attachments: attachments.map((attachment) => attachment.toJson()),
      tags: tags.map((tag) => tag.toJson()),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    })
  }

  async getStatus({ statusId }: GetStatusParams) {
    const status = await this.database('statuses').where('id', statusId).first()
    if (!status) return undefined
    return this.getStatusWithAttachmentsFromData(status)
  }

  async getStatuses({ actorId }: GetStatusesParams) {
    const postsPerPage = 30
    const query = this.database('recipients')
      .leftJoin('statuses', 'recipients.statusId', 'statuses.id')
      .where('recipients.type', 'local')
      .andWhere('recipients.actorId', actorId)
      .andWhereLike('reply', `${actorId}%`)
      .orWhere('reply', '')
      .distinct('statusId')
      .orderBy('recipients.createdAt', 'desc')
      .limit(postsPerPage)
    const local = await query
    const statuses = (
      await Promise.all(
        local.map((item) => this.getStatus({ statusId: item.statusId }))
      )
    ).filter((item): item is Status => item !== undefined)
    return statuses
  }

  async getActorStatusesCount({ actorId }: GetActorStatusesCountParams) {
    const result = await this.database('statuses')
      .where('actorId', actorId)
      .count<{ count: number }>('* as count')
      .first()
    return result?.count || 0
  }

  async getActorStatuses({ actorId }: GetActorStatusesParams) {
    const statuses = await this.database('statuses')
      .where('actorId', actorId)
      .andWhere('reply', '')
      .orderBy('createdAt', 'desc')
      .limit(20)
    return Promise.all(
      statuses.map((item) => this.getStatusWithAttachmentsFromData(item))
    )
  }

  async deleteStatus({ statusId }: DeleteStatusParams) {
    await this.database.transaction(async (trx) => {
      await Promise.all([
        trx('statuses').where('id', statusId).delete(),
        trx('recipients').where('statusId', statusId).delete(),
        trx('tags').where('statusId', statusId).delete(),
        trx('attachments').where('statusId', statusId).delete()
      ])
    })
  }

  async createAttachment({
    statusId,
    mediaType,
    url,
    width,
    height,
    name = ''
  }: CreateAttachmentParams): Promise<Attachment> {
    const currentTime = Date.now()
    const data: AttachmentData = {
      id: crypto.randomUUID(),
      statusId,
      type: 'Document',
      mediaType,
      url,
      width,
      height,
      name,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.database('attachments').insert(data)
    return new Attachment(data)
  }

  async getAttachments({ statusId }: GetAttachmentsParams) {
    const data = await this.database<AttachmentData>('attachments').where(
      'statusId',
      statusId
    )
    return data.map((item) => new Attachment(item))
  }

  async createTag({ statusId, name, value }: CreateTagParams): Promise<Tag> {
    const currentTime = Date.now()

    const data: TagData = {
      id: crypto.randomUUID(),
      statusId,
      type: 'mention',
      name,
      value: value || '',
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.database('tags').insert(data)
    return new Tag(data)
  }

  async getTags({ statusId }: GetTagsParams) {
    const data = await this.database<TagData>('tags').where(
      'statusId',
      statusId
    )
    return data.map((item) => new Tag(item))
  }
}
