/* eslint-disable @typescript-eslint/no-unused-vars */
import { Mastodon } from '@llun/activities.schema'
import crypto from 'crypto'
import { Knex, knex } from 'knex'
import omit from 'lodash/omit'

import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'
import { Attachment, AttachmentData } from '@/lib/models/attachment'
import { Follow, FollowStatus } from '@/lib/models/follow'
import { AuthCode } from '@/lib/models/oauth2/authCode'
import { Client } from '@/lib/models/oauth2/client'
import { Token } from '@/lib/models/oauth2/token'
import { User } from '@/lib/models/oauth2/user'
import { PollChoice } from '@/lib/models/pollChoice'
import { Session } from '@/lib/models/session'
import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/models/status'
import { Tag, TagData } from '@/lib/models/tag'
import { Timeline } from '@/lib/services/timelines/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'

import { PER_PAGE_LIMIT } from '.'
import { getISOTimeUTC } from '../utils/getISOTimeUTC'
import {
  CreateTagParams,
  CreateTimelineStatusParams,
  GetTagsParams,
  GetTimelineParams,
  Storage
} from './types'
import {
  CreateAccountParams,
  CreateAccountSessionParams,
  DeleteAccountSessionParams,
  GetAccountAllSessionsParams,
  GetAccountFromIdParams,
  GetAccountFromProviderIdParams,
  GetAccountSessionParams,
  IsAccountExistsParams,
  IsUsernameExistsParams,
  LinkAccountWithProviderParams,
  UpdateAccountSessionParams,
  VerifyAccountParams
} from './types/acount'
import {
  CreateActorParams,
  DeleteActorParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  IsCurrentActorFollowingParams,
  UpdateActorParams
} from './types/actor'
import {
  CreateFollowParams,
  GetAcceptedOrRequestedFollowParams,
  GetFollowFromIdParams,
  GetFollowersInboxParams,
  GetLocalActorsFromFollowerUrlParams,
  GetLocalFollowersForActorIdParams,
  GetLocalFollowsFromInboxUrlParams,
  UpdateFollowStatusParams
} from './types/follower'
import {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams
} from './types/like'
import {
  CreateAttachmentParams,
  CreateMediaParams,
  GetAttachmentsForActorParams,
  GetAttachmentsParams
} from './types/media'
import {
  CreateAccessTokenParams,
  CreateAuthCodeParams,
  CreateClientParams,
  GetAccessTokenByRefreshTokenParams,
  GetAccessTokenParams,
  GetAuthCodeParams,
  GetClientFromIdParams,
  GetClientFromNameParams,
  RevokeAccessTokenParams,
  RevokeAuthCodeParams,
  UpdateClientParams,
  UpdateRefreshTokenParams
} from './types/oauth'
import {
  CreateAnnounceParams,
  CreateNoteParams,
  CreatePollParams,
  DeleteStatusParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetFavouritedByParams,
  GetStatusParams,
  GetStatusRepliesParams,
  HasActorAnnouncedStatusParams,
  UpdateNoteParams,
  UpdatePollParams
} from './types/status'

interface ActorSettings {
  iconUrl?: string
  headerImageUrl?: string
  appleSharedAlbumToken?: string
  followersUrl: string
  inboxUrl: string
  sharedInboxUrl: string
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

export class SqlStorage implements Storage {
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
    const result = await this.database('accounts')
      .where('email', email)
      .count<{ count: number }>('id as count')
      .first()
    return Boolean(result?.count && result?.count > 0)
  }

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    const response = await this.database('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .count<{ count: number }>('id as count')
      .first()
    return Boolean(response?.count && response?.count > 0)
  }

  async createAccount({
    email,
    username,
    passwordHash,
    verificationCode,
    domain,
    privateKey,
    publicKey
  }: CreateAccountParams) {
    const accountId = crypto.randomUUID()
    const actorId = `https://${domain}/users/${username}`
    const currentTime = Date.now()

    const actorSettings: ActorSettings = {
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${domain}/inbox`
    }

    await this.database.transaction(async (trx) => {
      await trx('accounts').insert({
        id: accountId,
        email,
        passwordHash,
        ...(verificationCode
          ? { verificationCode }
          : { verifiedAt: currentTime }),
        createdAt: currentTime,
        updatedAt: currentTime
      })
      await trx('actors').insert({
        id: actorId,
        accountId,
        username,
        domain,
        settings: JSON.stringify(actorSettings),
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

  async getAccountFromProviderId({
    provider,
    accountId
  }: GetAccountFromProviderIdParams): Promise<Account | undefined> {
    return this.database('account_providers')
      .where('provider', provider)
      .where('providerId', accountId)
      .join('accounts', 'account_providers.accountId', '=', 'accounts.id')
      .select<Account>('accounts.*')
      .first()
  }

  async linkAccountWithProvider({
    accountId,
    providerAccountId,
    provider
  }: LinkAccountWithProviderParams): Promise<Account | undefined> {
    const [existingLinkAccount, account] = await Promise.all([
      this.database('account_providers')
        .where('provider', provider)
        .where('providerId', providerAccountId)
        .first(),
      this.database('accounts').where('id', accountId).first<Account>()
    ])

    if (existingLinkAccount) return
    if (!account) return

    const currentTime = Date.now()
    await this.database('account_providers').insert({
      id: crypto.randomUUID(),
      provider,
      providerId: providerAccountId,
      accountId,

      createdAt: currentTime,
      updatedAt: currentTime
    })
    return account
  }

  async verifyAccount({ verificationCode }: VerifyAccountParams) {
    const account = await this.database('accounts')
      .where('verificationCode', verificationCode)
      .first<Account>()
    if (!account) return

    const currentTime = Date.now()
    await this.database('accounts').where('id', account.id).update({
      verificationCode: '',
      verifiedAt: currentTime,
      updatedAt: currentTime
    })
    return this.getAccountFromId({ id: account.id })
  }

  async createAccountSession({
    accountId,
    expireAt,
    token
  }: CreateAccountSessionParams): Promise<void> {
    const currentTime = Date.now()

    await this.database('sessions').insert({
      id: crypto.randomUUID(),
      accountId,
      token,

      expireAt,

      createdAt: currentTime,
      updatedAt: currentTime
    })
  }

  async getAccountSession({
    token
  }: GetAccountSessionParams): Promise<
    { account: Account; session: Session } | undefined
  > {
    const session = await this.database('sessions')
      .where('token', token)
      .first()
    if (!session) return

    const {
      accountId,
      token: sessionToken,
      expireAt,
      createdAt,
      updatedAt
    } = session
    const account = await this.getAccountFromId({ id: accountId })
    if (!account) return

    return {
      account,
      session: {
        accountId,
        expireAt,
        token: sessionToken,
        createdAt,
        updatedAt
      }
    }
  }

  async getAccountAllSessions({
    accountId
  }: GetAccountAllSessionsParams): Promise<Session[]> {
    return this.database<Session>('sessions').where('accountId', accountId)
  }

  async updateAccountSession({
    token,
    expireAt
  }: UpdateAccountSessionParams): Promise<void> {
    if (!expireAt) return

    return this.database('sessions').where('token', token).update({ expireAt })
  }

  async deleteAccountSession({
    token
  }: DeleteAccountSessionParams): Promise<void> {
    await this.database('sessions').where('token', token).delete()
  }

  async createActor({
    actorId,

    username,
    domain,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    followersUrl,
    inboxUrl,
    sharedInboxUrl,

    publicKey,
    privateKey,

    createdAt
  }: CreateActorParams) {
    const currentTime = Date.now()

    const settings: ActorSettings = {
      iconUrl,
      headerImageUrl,
      followersUrl,
      inboxUrl,
      sharedInboxUrl
    }
    await this.database('actors').insert({
      id: actorId,
      username,
      domain,
      name,
      summary,
      settings: JSON.stringify(settings),
      publicKey,
      privateKey,
      createdAt,
      updatedAt: currentTime
    })
    return this.getActorFromId({ id: actorId })
  }

  async createMastodonActor({
    actorId,

    username,
    domain,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    followersUrl,
    inboxUrl,
    sharedInboxUrl,

    publicKey,
    privateKey,

    createdAt
  }: CreateActorParams): Promise<Mastodon.Account | null> {
    const currentTime = Date.now()

    const settings: ActorSettings = {
      iconUrl,
      headerImageUrl,
      followersUrl,
      inboxUrl,
      sharedInboxUrl
    }
    await this.database('actors').insert({
      id: actorId,
      username,
      domain,
      name,
      summary,
      settings: JSON.stringify(settings),
      publicKey,
      privateKey,
      createdAt,
      updatedAt: currentTime
    })
    return this.getMastodonActor(actorId)
  }

  private getActor(sqlActor: SQLActor, account?: Account) {
    const settings = JSON.parse(sqlActor.settings || '{}') as ActorSettings
    return new Actor({
      id: sqlActor.id,
      username: sqlActor.username,
      domain: sqlActor.domain,
      ...(sqlActor.name ? { name: sqlActor.name } : null),
      ...(sqlActor.summary ? { summary: sqlActor.summary } : null),
      ...(settings.iconUrl ? { iconUrl: settings.iconUrl } : null),
      ...(settings.headerImageUrl
        ? { headerImageUrl: settings.headerImageUrl }
        : null),
      ...(settings.appleSharedAlbumToken
        ? { appleSharedAlbumToken: settings.appleSharedAlbumToken }
        : null),
      followersUrl: settings.followersUrl,
      inboxUrl: settings.inboxUrl,
      sharedInboxUrl: settings.sharedInboxUrl,
      publicKey: sqlActor.publicKey,
      ...(sqlActor.privateKey ? { privateKey: sqlActor.privateKey } : null),
      ...(account ? { account } : null),
      createdAt: sqlActor.createdAt,
      updatedAt: sqlActor.updatedAt
    })
  }

  private async getMastodonActor(actorId: string) {
    const sqlActor = await this.database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!sqlActor) return null

    const [lastStatusCreatedAt, totalStatus, totalFollowers, totalFollowing] =
      await this.database.transaction(async (trx) =>
        Promise.all([
          trx('statuses')
            .where('actorId', actorId)
            .orderBy('createdAt', 'desc')
            .select('createdAt')
            .first(),
          trx('statuses')
            .where('actorId', actorId)
            .count<{ count: number }>('* as count')
            .first(),
          trx('follows')
            .where('targetActorId', actorId)
            .andWhere('status', 'Accepted')
            .count<{ count: number }>('* as count')
            .first(),
          trx('follows')
            .where('actorId', actorId)
            .andWhere('status', 'Accepted')
            .count<{ count: number }>('* as count')
            .first()
        ])
      )

    const settings = JSON.parse(sqlActor.settings || '{}') as ActorSettings
    return Mastodon.Account.parse({
      id: sqlActor.id,
      username: sqlActor.username,
      acct: `${sqlActor.username}@${sqlActor.domain}`,
      url: `https://${sqlActor.domain}/@${sqlActor.username}`,
      display_name: sqlActor.name ?? '',
      note: sqlActor.summary ?? '',

      avatar: settings.iconUrl ?? '',
      avatar_static: settings.iconUrl ?? '',
      header: settings.headerImageUrl ?? '',
      header_static: settings.headerImageUrl ?? '',

      fields: [],
      emojis: [],

      locked: false,
      bot: false,
      group: false,
      discoverable: true,
      noindex: false,

      created_at: getISOTimeUTC(sqlActor.createdAt),
      last_status_at: lastStatusCreatedAt
        ? getISOTimeUTC(lastStatusCreatedAt)
        : null,

      followers_count: totalFollowers?.count ?? 0,
      following_count: totalFollowing?.count ?? 0,
      statuses_count: totalStatus?.count ?? 0
    })
  }

  async getActorFromEmail({ email }: GetActorFromEmailParams) {
    const storageActor = await this.database('actors')
      .select<SQLActor>('actors.*')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first()
    if (!storageActor) return undefined

    const account = await this.getAccountFromId({ id: storageActor.accountId })
    return this.getActor(storageActor, account)
  }

  async getMastodonActorFromEmail({ email }: GetActorFromEmailParams) {
    const result = await this.database('actors')
      .select('actors.id')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first<{ id: string }>()
    if (!result) return null
    return this.getMastodonActor(result.id)
  }

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams) {
    const result = await this.database('follows')
      .where('actorId', currentActorId)
      .andWhere('targetActorId', followingActorId)
      .andWhere('status', 'Accepted')
      .count<{ count: number }>('id as count')
      .first()
    return Boolean(result?.count && result?.count > 0)
  }

  async getActorFromUsername({ username, domain }: GetActorFromUsernameParams) {
    const storageActor = await this.database<SQLActor>('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .first()
    if (!storageActor) return undefined

    const account = await this.getAccountFromId({ id: storageActor.accountId })
    return this.getActor(storageActor, account)
  }

  async getMastodonActorFromUsername({
    username,
    domain
  }: GetActorFromUsernameParams) {
    const result = await this.database<SQLActor>('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .select('id')
      .first<{ id: string }>()
    if (!result) return null

    return this.getMastodonActor(result.id)
  }

  async getActorFromId({ id }: GetActorFromIdParams) {
    const storageActor = await this.database<SQLActor>('actors')
      .where('id', id)
      .first()
    if (!storageActor) return undefined

    if (!storageActor.accountId) {
      return this.getActor(storageActor)
    }

    const account = await this.getAccountFromId({ id: storageActor.accountId })
    return this.getActor(storageActor, account)
  }

  async updateActor({
    actorId,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    appleSharedAlbumToken,

    publicKey,

    followersUrl,
    inboxUrl,
    sharedInboxUrl
  }: UpdateActorParams) {
    const storageActor = await this.database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!storageActor) return undefined

    const settings: ActorSettings = {
      ...JSON.parse(storageActor.settings),
      ...(iconUrl ? { iconUrl } : null),
      ...(headerImageUrl ? { headerImageUrl } : null),
      ...(appleSharedAlbumToken ? { appleSharedAlbumToken } : null),

      ...(followersUrl ? { followersUrl } : null),
      ...(inboxUrl ? { inboxUrl } : null),
      ...(sharedInboxUrl ? { sharedInboxUrl } : null)
    }

    await this.database<SQLActor>('actors')
      .where('id', actorId)
      .update({
        ...(name ? { name } : null),
        ...(summary ? { summary } : null),

        ...(publicKey ? { publicKey } : null),

        settings: JSON.stringify(settings),
        updatedAt: Date.now()
      })
    return this.getActorFromId({ id: actorId })
  }

  async deleteActor({ actorId }: DeleteActorParams) {
    await this.database('actors').where('id', actorId).delete()
  }

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    const result = await this.database('follows')
      .where('actorId', actorId)
      .andWhere('status', 'Accepted')
      .count<{ count: number }>('* as count')
      .first()
    return result?.count ?? 0
  }

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    const result = await this.database('follows')
      .where('targetActorId', actorId)
      .andWhere('status', 'Accepted')
      .count<{ count: number }>('* as count')
      .first()
    return result?.count ?? 0
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
    const actor = await this.getActorFromId({ id: targetActorId })
    // External actor, all followers are internal
    if (!actor?.privateKey) {
      return this.database<Follow>('follows')
        .where('targetActorId', targetActorId)
        .whereIn('status', [FollowStatus.enum.Accepted])
        .orderBy('createdAt', 'desc')
    }

    const domains = (
      await this.database('actors')
        .whereNotNull('privateKey')
        .select('domain')
        .distinct()
    ).map((item) => item.domain)

    return this.database<Follow>('follows')
      .where('targetActorId', targetActorId)
      .whereIn('actorHost', domains)
      .whereIn('status', [FollowStatus.enum.Accepted])
      .orderBy('createdAt', 'desc')
  }

  async getLocalFollowsFromInboxUrl({
    targetActorId,
    followerInboxUrl
  }: GetLocalFollowsFromInboxUrlParams) {
    const [followsFromInbox, followsFromSharedInbox] = await Promise.all([
      this.database<Follow>('follows')
        .where('targetActorId', targetActorId)
        .where('inbox', followerInboxUrl),
      this.database<Follow>('follows')
        .where('targetActorId', targetActorId)
        .where('sharedInbox', followerInboxUrl)
    ])
    const uniqueFollows: Record<string, Follow> = {}
    for (const follow of [...followsFromInbox, ...followsFromSharedInbox]) {
      uniqueFollows[follow.id] = follow
    }

    return Object.values(uniqueFollows)
  }

  async getLocalActorsFromFollowerUrl({
    followerUrl
  }: GetLocalActorsFromFollowerUrlParams) {
    const actor = await this.database('actors')
      .jsonExtract('settings', '$.followersUrl', 'followersUrl')
      .where('followersUrl', followerUrl)
      .select('id')
      .first()
    if (!actor?.id) return []

    const localActors = await this.database('actors')
      .leftJoin('follows', 'follows.actorId', 'actors.id')
      .where('follows.targetActorId', actor.id)
      .where('follows.status', FollowStatus.enum.Accepted)
      .where('actors.privateKey', '<>', '')
      .select('actors.*')
    return Promise.all(
      localActors.map(async (actor) => {
        const account = await this.getAccountFromId({
          id: actor.accountId
        })
        return this.getActor(actor, account)
      })
    )
  }

  async getAcceptedOrRequestedFollow({
    actorId,
    targetActorId
  }: GetAcceptedOrRequestedFollowParams) {
    return this.database<Follow>('follows')
      .where('actorId', actorId)
      .where('targetActorId', targetActorId)
      .whereIn('status', [
        FollowStatus.enum.Accepted,
        FollowStatus.enum.Requested
      ])
      .orderBy('createdAt', 'desc')
      .first()
  }

  async getFollowersInbox({ targetActorId }: GetFollowersInboxParams) {
    const follows = await this.database<Follow>('follows')
      .where('targetActorId', targetActorId)
      .where('status', FollowStatus.enum.Accepted)
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

    await this.database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        actorId,
        type: StatusType.enum.Note,
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
    })

    const actor = await this.getActorFromId({ id: actorId })
    return new Status({
      id,
      url,
      actorId,
      actor: actor?.toProfile() || null,
      type: StatusType.enum.Note,
      text,
      summary,
      reply,
      to,
      cc,
      edits: [],
      attachments: [],
      tags: [],
      replies: [],
      totalLikes: 0,
      isActorLiked: false,
      isActorAnnounced: false,
      isLocalActor: Boolean(actor?.account),
      createdAt: statusCreatedAt,
      updatedAt: statusUpdatedAt
    })
  }

  async updateNote({
    statusId,
    text,
    summary
  }: UpdateNoteParams): Promise<Status | undefined> {
    const status = await this.getStatus({ statusId })
    if (!status) return

    const data = status.data
    if (data.type !== StatusType.enum.Note) return

    const previousData = {
      text: data.text,
      summary: data.summary
    }
    const currentTime = Date.now()
    await this.database.transaction(async (trx) => {
      await trx('status_history').insert({
        statusId: status.id,
        data: JSON.stringify(previousData),
        createdAt: status.createdAt,
        updatedAt: currentTime
      })
      await trx('statuses')
        .where('id', status.id)
        .update({
          content: JSON.stringify({
            url: status.url,
            text,
            summary
          }),
          updatedAt: currentTime
        })
    })
    return this.getStatus({ statusId })
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

    await this.database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        actorId,
        type: StatusType.enum.Announce,
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
    })

    const [originalStatus, actor] = await Promise.all([
      this.getStatus({ statusId: originalStatusId }),
      this.getActorFromId({ id: actorId })
    ])
    const announceData: StatusAnnounce = {
      id,
      actorId,
      actor: actor?.toProfile() || null,
      to,
      cc,
      edits: [],
      type: StatusType.enum.Announce,
      originalStatus: originalStatus?.data as StatusNote,

      createdAt: statusUpdatedAt,
      updatedAt: statusUpdatedAt
    }

    return new Status(announceData)
  }

  async createPoll({
    id,
    url,
    actorId,
    text,
    summary = '',
    to,
    cc,
    reply = '',
    endAt,
    choices,
    createdAt
  }: CreatePollParams) {
    const currentTime = Date.now()
    const statusCreatedAt = createdAt || currentTime
    const statusUpdatedAt = currentTime

    await this.database.transaction(async (trx) => {
      await trx('statuses').insert({
        id,
        actorId,
        type: StatusType.enum.Poll,
        content: JSON.stringify({
          url,
          text,
          summary,
          endAt
        }),
        reply,
        createdAt: statusCreatedAt,
        updatedAt: statusUpdatedAt
      })
      await Promise.all(
        choices.map((choice) =>
          trx('poll_choices').insert({
            statusId: id,
            title: choice,

            createdAt: statusUpdatedAt,
            updatedAt: statusUpdatedAt
          })
        )
      )
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
    })

    const actor = await this.getActorFromId({ id: actorId })
    return new Status({
      id,
      url,
      actorId,
      actor: actor?.toProfile() || null,
      type: StatusType.enum.Poll,
      text,
      summary,
      reply,
      to,
      cc,
      edits: [],
      tags: [],
      replies: [],
      choices: [],
      totalLikes: 0,
      isActorLiked: false,
      isActorAnnounced: false,
      endAt,
      createdAt: statusCreatedAt,
      updatedAt: statusUpdatedAt
    })
  }

  async updatePoll({ statusId, text, summary, choices }: UpdatePollParams) {
    const existingStatus = await this.database('statuses')
      .where('id', statusId)
      .first()
    if (!existingStatus) return
    const currentTime = Date.now()

    await this.database.transaction(async (trx) => {
      if (text !== existingStatus.text || summary !== existingStatus.summary) {
        const data = JSON.parse(existingStatus.content)
        const previousData = {
          text: data.text,
          summary: data.summary
        }
        await trx('status_history').insert({
          statusId,
          data: JSON.stringify(previousData),
          createdAt: existingStatus.createdAt,
          updatedAt: currentTime
        })
        await trx('statuses')
          .where('id', statusId)
          .update({
            content: {
              url: data.url,
              text: data.text,
              summary: data.summary
            },
            updatedAt: currentTime
          })
      }
      for (const choice of choices) {
        await trx('poll_choices')
          .where({
            statusId,
            title: choice.title
          })
          .update({
            totalVotes: choice.totalVotes,
            updatedAt: currentTime
          })
      }
    })
    return this.getStatus({ statusId })
  }

  private async getPollChoices(statusId: string) {
    const raw = await this.database('poll_choices')
      .where('statusId', statusId)
      .orderBy('choiceId', 'asc')
    return raw.map((data) => new PollChoice(data))
  }

  private async getStatusWithAttachmentsFromData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    currentActorId?: string
  ): Promise<Status> {
    const [to, cc] = await Promise.all([
      this.database('recipients')
        .where('statusId', data.id)
        .andWhere('type', 'to'),
      this.database('recipients')
        .where('statusId', data.id)
        .andWhere('type', 'cc')
    ])

    if (data.type === StatusType.enum.Announce) {
      const originalStatusId = data.content
      const [actor, originalStatus] = await Promise.all([
        this.getActorFromId({ id: data.actorId }),
        this.getStatusWithCurrentActorId(originalStatusId, currentActorId)
      ])

      const announceData: StatusAnnounce = {
        id: data.id,
        actorId: data.actorId,
        actor: actor?.toProfile() || null,
        type: StatusType.enum.Announce,
        to: to.map((item) => item.actorId),
        cc: cc.map((item) => item.actorId),
        edits: [],
        originalStatus: originalStatus?.data as StatusNote,

        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      }

      return new Status(announceData)
    }

    const [
      attachments,
      tags,
      replies,
      actor,
      totalLikes,
      isActorLikedStatus,
      isActorAnnouncedStatus,
      pollChoices,
      edits
    ] = await Promise.all([
      this.getAttachments({ statusId: data.id }),
      this.getTags({ statusId: data.id }),
      this.database('statuses')
        .select('id')
        .where('reply', data.id)
        .orderBy('createdAt', 'desc'),
      this.getActorFromId({ id: data.actorId }),
      this.database('likes')
        .where('statusId', data.id)
        .count<{ count: number }>('* as count')
        .first(),
      this.isActorLikedStatus(data.id, currentActorId),
      this.hasActorAnnouncedStatus({
        statusId: data.id,
        actorId: currentActorId
      }),
      this.getPollChoices(data.id),
      this.database('status_history').where('statusId', data.id)
    ])

    const repliesNote = (
      await Promise.all(
        replies.map((item) => this.getStatus({ statusId: item.id }))
      )
    )
      .map((item) =>
        item?.data.type &&
        [StatusType.enum.Note, StatusType.enum.Poll].includes(
          item?.data.type as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
          ? item.data
          : null
      )
      .filter((item): item is StatusNote => Boolean(item))

    const content = JSON.parse(data.content)
    return new Status({
      id: data.id,
      url: content.url,
      to: to.map((item) => item.actorId),
      cc: cc.map((item) => item.actorId),
      actorId: data.actorId,
      actor: actor?.toProfile() || null,
      type: data.type,
      text: content.text,
      summary: content.summary,
      reply: data.reply,
      replies: repliesNote,
      totalLikes: totalLikes?.count ?? 0,
      isActorLiked: isActorLikedStatus,
      isActorAnnounced: isActorAnnouncedStatus,
      isLocalActor: Boolean(actor?.account),
      attachments: attachments.map((attachment) => attachment.toJson()),
      tags: tags.map((tag) => tag.toJson()),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,

      edits: edits.map((item) => {
        const content = JSON.parse(item.data)
        return {
          text: content.text,
          summary: content.summary ?? null,
          createdAt: item.createdAt
        }
      }),

      ...(data.type === StatusType.enum.Poll
        ? {
            choices: pollChoices.map((choice) => choice.toJson()),
            endAt: content.endAt
          }
        : null)
    })
  }

  private async getStatusWithCurrentActorId(
    statusId: string,
    currentActorId?: string
  ) {
    const status = await this.database('statuses').where('id', statusId).first()
    if (!status) return

    return this.getStatusWithAttachmentsFromData(status, currentActorId)
  }

  async getStatus({ statusId }: GetStatusParams) {
    return this.getStatusWithCurrentActorId(statusId)
  }

  async getStatusReplies({ statusId }: GetStatusRepliesParams) {
    const statuses = await this.database('statuses')
      .where('reply', statusId)
      .orderBy('createdAt', 'desc')
    return Promise.all(
      statuses.map((status) => this.getStatusWithAttachmentsFromData(status))
    )
  }

  async hasActorAnnouncedStatus({
    actorId,
    statusId
  }: HasActorAnnouncedStatusParams): Promise<boolean> {
    if (!actorId) return false

    const result = await this.database('statuses')
      .where('type', StatusType.enum.Announce)
      .where('content', statusId)
      .where('actorId', actorId)
      .count<{ count: number }>('* as count')
      .first()
    if (!result) return false
    return result.count !== 0
  }

  async getTimeline({
    timeline,
    actorId,
    startAfterStatusId
  }: GetTimelineParams) {
    switch (timeline) {
      case Timeline.LOCAL_PUBLIC: {
        const query = this.database('recipients')
          .leftJoin('statuses', 'recipients.statusId', 'statuses.id')
          .leftJoin('actors', 'statuses.actorId', 'actors.id')
          .where('recipients.type', 'to')
          .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
          .whereNotNull('actors.privateKey')
          .where('statuses.reply', '')
          .orderBy('recipients.createdAt', 'desc')
          .limit(PER_PAGE_LIMIT)
        const local = await query
        const statuses = (
          await Promise.all(
            local.map((item) => this.getStatus({ statusId: item.statusId }))
          )
        ).filter((item): item is Status => item !== undefined)
        return statuses
      }
      case Timeline.MAIN:
      case Timeline.HOME:
      case Timeline.MENTION:
      case Timeline.NOANNOUNCE: {
        if (!actorId) return []

        const actualTimeline =
          timeline === Timeline.HOME ? Timeline.MAIN : timeline
        const limit = PER_PAGE_LIMIT
        const startAfterId = startAfterStatusId
          ? (
              await this.database('timelines')
                .where('actorId', actorId)
                .where('timeline', actualTimeline)
                .where('statusId', startAfterStatusId)
                .select('id')
                .first<{ id: number }>()
            ).id
          : 0

        const statusesId = await (startAfterStatusId
          ? this.database('timelines')
              .where('actorId', actorId)
              .where('timeline', actualTimeline)
              .where('id', '<', startAfterId)
              .select('statusId')
              .orderBy('createdAt', 'desc')
              .limit(limit)
          : this.database('timelines')
              .where('actorId', actorId)
              .where('timeline', actualTimeline)
              .select('statusId')
              .orderBy('createdAt', 'desc')
              .limit(limit))

        const statuses = await Promise.all(
          statusesId
            .map((item) => item.statusId)
            .map((statusId) =>
              this.getStatusWithCurrentActorId(statusId, actorId)
            )
        )

        return statuses.filter(
          (status): status is Status => status !== undefined
        )
      }
      default: {
        return []
      }
    }
  }

  async createTimelineStatus({
    actorId,
    status,
    timeline
  }: CreateTimelineStatusParams): Promise<void> {
    await this.database.transaction(async (trx) => {
      const exists = await trx('timelines')
        .where('actorId', actorId)
        .andWhere('statusId', status.id)
        .andWhere('timeline', timeline)
        .count<{ count: number }>('* as count')
        .first()
      if (exists && exists.count) return

      return trx('timelines').insert({
        actorId,
        statusId: status.id,
        statusActorId: status.actorId,
        timeline,
        createdAt: status.createdAt,
        updatedAt: Date.now()
      })
    })
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
      .orderBy('createdAt', 'desc')
      .limit(PER_PAGE_LIMIT)
    return Promise.all(
      statuses.map((item) => this.getStatusWithAttachmentsFromData(item))
    )
  }

  async deleteStatus({ statusId }: DeleteStatusParams) {
    const replies = await this.database('statuses')
      .where('reply', statusId)
      .select('id')
    await Promise.all(
      replies.map(({ id }) => this.deleteStatus({ statusId: id }))
    )

    await this.database.transaction(async (trx) => {
      await Promise.all([
        trx('statuses').where('id', statusId).delete(),
        trx('recipients').where('statusId', statusId).delete(),
        trx('tags').where('statusId', statusId).delete(),
        trx('attachments').where('statusId', statusId).delete(),
        trx('timelines').where('statusId', statusId).delete()
      ])
    })
  }

  async getFavouritedBy({ statusId }: GetFavouritedByParams): Promise<Actor[]> {
    const result = await this.database('likes').where({ statusId })
    const actors = await Promise.all(
      result.map((item) => this.getActorFromId({ id: item.actorId }))
    )
    return actors.filter((actor): actor is Actor => Boolean(actor))
  }

  async createAttachment({
    actorId,
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
      actorId,
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

  async getAttachmentsForActor({
    actorId
  }: GetAttachmentsForActorParams): Promise<Attachment[]> {
    const data = await this.database<AttachmentData>('attachments')
      .where('actorId', actorId)
      .orderBy('createdAt')
      .limit(30)
    return data.map((item) => new Attachment(item))
  }

  async createTag({
    statusId,
    name,
    value,
    type
  }: CreateTagParams): Promise<Tag> {
    const currentTime = Date.now()

    const data: TagData = {
      id: crypto.randomUUID(),
      statusId,
      type,
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

  async createLike({ actorId, statusId }: CreateLikeParams) {
    const status = await this.database('statuses').where('id', statusId).first()
    if (!status) return

    const result = await this.database('likes')
      .where({ actorId, statusId })
      .count<{ count: number }>('* as count')
      .first()
    if (result?.count === 1) {
      return
    }

    await this.database('likes').insert({
      actorId,
      statusId
    })
  }

  async deleteLike({ statusId, actorId }: DeleteLikeParams) {
    await this.database('likes').where({ actorId, statusId }).delete()
  }

  async getLikeCount({ statusId }: GetLikeCountParams) {
    const result = await this.database('likes')
      .where('statusId', statusId)
      .count<{ count: number }>('* as count')
      .first()
    return result?.count ?? 0
  }

  private async isActorLikedStatus(statusId: string, actorId?: string) {
    if (!actorId) return false

    const result = await this.database('likes')
      .where('statusId', statusId)
      .where('actorId', actorId)
      .count<{ count: number }>('* as count')
      .first()
    if (!result) return false
    return result.count !== 0
  }

  async createMedia({
    actorId,
    original,
    thumbnail,
    description
  }: CreateMediaParams) {
    if (!actorId) return null

    const content = {
      actorId,
      original: original.path,
      originalBytes: original.bytes,
      originalMimeType: original.mimeType,
      originalMetaData: JSON.stringify(original.metaData),
      ...(thumbnail
        ? {
            thumbnail: thumbnail.path,
            thumbnailBytes: thumbnail.bytes,
            thumbnailMimeType: thumbnail.mimeType,
            thumbnailMetaData: JSON.stringify(thumbnail.metaData)
          }
        : null),
      ...(description ? { description } : null)
    }

    const ids = await this.database('medias').insert(content, ['id'])
    if (ids.length === 0) return null
    return {
      id: ids[0].id,
      actorId,
      original,
      thumbnail,
      description
    }
  }

  async createClient(params: CreateClientParams) {
    const { name, redirectUris, secret, scopes, ...rest } =
      CreateClientParams.parse(params)
    const clientNameCountResult = await this.database('clients')
      .where('name', name)
      .count<{ count: number }>('id as count')
      .first()
    if (clientNameCountResult?.count && clientNameCountResult?.count > 0) {
      throw new Error(`Client ${name} is already exists`)
    }

    const id = crypto.randomUUID()
    const currentTime = Date.now()
    const client = Client.parse({
      id,
      name,
      secret,

      scopes,
      redirectUris,

      ...(rest.website ? { website: rest.website } : null),

      createdAt: currentTime,
      updatedAt: currentTime
    })
    await this.database('clients').insert({
      ...omit(client, ['allowedGrants']),
      scopes: JSON.stringify(scopes),
      redirectUris: JSON.stringify(redirectUris)
    })
    return client
  }

  async getClientFromName({ name }: GetClientFromNameParams) {
    const clientData = await this.database('clients')
      .where('name', name)
      .first()
    if (!clientData) return null
    const client = Client.parse({
      id: clientData.id,
      name: clientData.name,
      secret: clientData.secret,
      scopes: JSON.parse(clientData.scopes),
      redirectUris: JSON.parse(clientData.redirectUris),
      ...(clientData.website ? { website: clientData.website } : null),
      updatedAt: clientData.updatedAt,
      createdAt: clientData.createdAt
    })
    return client
  }

  async getClientFromId({ clientId }: GetClientFromIdParams) {
    const clientData = await this.database('clients')
      .where('id', clientId)
      .first()
    if (!clientData) return null
    return Client.parse({
      id: clientData.id,
      name: clientData.name,
      secret: clientData.secret,
      scopes: JSON.parse(clientData.scopes),
      redirectUris: JSON.parse(clientData.redirectUris),
      ...(clientData.website ? { website: clientData.website } : null),
      updatedAt: clientData.updatedAt,
      createdAt: clientData.createdAt
    })
  }

  async updateClient(params: UpdateClientParams) {
    const { id, name, secret, scopes, redirectUris, ...rest } =
      UpdateClientParams.parse(params)
    const client = await this.database('clients').where('id', id).first()
    if (!client) return null

    const currentTime = Date.now()
    const updatedClient = Client.parse({
      id: client.id,
      name,
      secret,
      scopes,
      redirectUris,
      ...(rest.website ? { website: rest.website } : null),
      updatedAt: currentTime,
      createdAt: client.createdAt
    })
    await this.database('clients')
      .where('id', id)
      .update({
        ...omit(updatedClient, ['allowedGrants']),
        scopes: JSON.stringify(updatedClient.scopes.map((scope) => scope.name)),
        redirectUris: JSON.stringify(updatedClient.redirectUris)
      })
    return updatedClient
  }

  async getAccessToken({ accessToken }: GetAccessTokenParams) {
    const data = await this.database('tokens')
      .where('accessToken', accessToken)
      .first()
    if (!data) return null

    const [client, actor, account] = await Promise.all([
      this.getClientFromId({ clientId: data.clientId }),
      this.getActorFromId({ id: data.actorId }),
      this.getAccountFromId({ id: data.accountId })
    ])

    return Token.parse({
      accessToken: data.accessToken,
      accessTokenExpiresAt: data.accessTokenExpiresAt,

      ...(data.refreshToken ? { refreshToken: data.refreshToken } : null),
      ...(data.refreshTokenExpiresAt
        ? { refreshTokenExpiresAt: data.refreshTokenExpiresAt }
        : null),

      scopes: JSON.parse(data.scopes),

      client: {
        ...client,
        scopes: client?.scopes.map((scope) => scope.name)
      },
      user: User.parse({
        id: actor?.id,
        actor: actor?.data,
        account
      }),

      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    })
  }

  async getAccessTokenByRefreshToken(
    params: GetAccessTokenByRefreshTokenParams
  ) {
    const { refreshToken } = GetAccessTokenByRefreshTokenParams.parse(params)
    const result = await this.database('tokens')
      .where('refreshToken', refreshToken)
      .first()
    return this.getAccessToken({ accessToken: result.accessToken })
  }

  async createAccessToken(params: CreateAccessTokenParams) {
    const {
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt,
      clientId,
      scopes,
      actorId,
      accountId
    } = CreateAccessTokenParams.parse(params)
    const currentTime = Date.now()
    const tokenCountResult = await this.database('tokens')
      .where('accessToken', accessToken)
      .count<{ count: number }>('accessToken as count')
      .first()
    if (tokenCountResult?.count && tokenCountResult?.count > 0) return null

    const actor = await this.getActorFromId({ id: actorId })
    if (!actor?.account || actor.account.id !== accountId) return null

    const token = {
      accessToken,
      accessTokenExpiresAt,
      ...(refreshToken ? { refreshToken } : null),
      ...(refreshTokenExpiresAt ? { refreshTokenExpiresAt } : null),
      scopes: JSON.stringify(scopes),
      clientId,
      actorId,
      accountId,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.database('tokens').insert(token)
    return this.getAccessToken({ accessToken })
  }

  async updateRefreshToken(params: UpdateRefreshTokenParams) {
    const { accessToken, refreshToken, refreshTokenExpiresAt } =
      UpdateRefreshTokenParams.parse(params)
    const [tokenCount, refreshTokenCount] = await Promise.all([
      this.database('tokens')
        .where('accessToken', accessToken)
        .count<{ count: number }>('* as count')
        .first(),
      this.database('tokens')
        .where('refreshToken', refreshToken)
        .count<{ count: number }>('* as count')
        .first()
    ])
    if (!tokenCount?.count) return null
    if (refreshTokenCount !== undefined && refreshTokenCount?.count > 0) {
      return null
    }
    await this.database('tokens').where('accessToken', accessToken).update({
      refreshToken,
      refreshTokenExpiresAt,
      updatedAt: Date.now()
    })
    return this.getAccessToken({ accessToken })
  }

  async revokeAccessToken(params: RevokeAccessTokenParams) {
    const { accessToken } = RevokeAccessTokenParams.parse(params)
    const currentTime = Date.now()
    await this.database('tokens').where('accessToken', accessToken).update({
      accessTokenExpiresAt: currentTime,
      refreshTokenExpiresAt: currentTime
    })
    return this.getAccessToken({ accessToken })
  }

  async createAuthCode(params: CreateAuthCodeParams) {
    const {
      code,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      actorId,
      accountId,
      clientId,
      scopes,
      expiresAt
    } = CreateAuthCodeParams.parse(params)
    const currentTime = Date.now()
    const codeCountResult = await this.database('auth_codes')
      .where('code', code)
      .count<{ count: number }>('* as count')
      .first()
    if (codeCountResult?.count && codeCountResult?.count > 0) return null

    const actor = await this.getActorFromId({ id: actorId })
    if (!actor?.account || actor.account.id !== accountId) return null

    const authCode = {
      code,
      ...(redirectUri ? { redirectUri } : null),
      ...(codeChallenge ? { codeChallenge } : null),
      ...(codeChallengeMethod ? { codeChallengeMethod } : null),
      scopes: JSON.stringify(scopes),
      clientId,
      actorId,
      accountId,
      expiresAt,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await this.database('auth_codes').insert(authCode)
    return this.getAuthCode({ code })
  }

  async getAuthCode(params: GetAuthCodeParams) {
    const { code } = GetAuthCodeParams.parse(params)
    const data = await this.database('auth_codes').where('code', code).first()
    if (!data) return null

    const [client, actor, account] = await Promise.all([
      this.getClientFromId({ clientId: data.clientId }),
      this.getActorFromId({ id: data.actorId }),
      this.getAccountFromId({ id: data.accountId })
    ])

    return AuthCode.parse({
      code: data.code,
      ...(data.redirectUri ? { redirectUri: data.redirectUri } : null),
      ...(data.codeChallenge ? { codeChallenge: data.codeChallenge } : null),
      ...(data.codeChallengeMethod
        ? { codeChallengeMethod: data.codeChallengeMethod }
        : null),

      scopes: JSON.parse(data.scopes),
      client: {
        ...client,
        scopes: client?.scopes.map((scope) => scope.name)
      },
      user: User.parse({
        id: actor?.id,
        actor: actor?.data,
        account
      }),

      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    })
  }

  async revokeAuthCode(params: RevokeAuthCodeParams) {
    const { code } = RevokeAuthCodeParams.parse(params)
    const currentTime = Date.now()
    await this.database('auth_codes').where('code', code).update({
      expiresAt: currentTime
    })
    return this.getAuthCode({ code })
  }
}
