import { Mastodon } from '@llun/activities.schema'
import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  ActorDatabase,
  CreateActorParams,
  DeleteActorParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  IsCurrentActorFollowingParams,
  IsInternalActorParams,
  UpdateActorParams
} from '@/lib/database/types/actor'
import { ActorSettings, SQLAccount, SQLActor } from '@/lib/database/types/sql'
import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export interface SQLActorDatabase extends ActorDatabase {
  getActor: (
    sqlActor: SQLActor,
    followingCount: number,
    followersCount: number,
    statusCount: number,
    lastStatusAt: number,
    sqlAccount?: SQLAccount
  ) => Actor
  getMastodonActor: (actorId: string) => Promise<Mastodon.Account | null>
}

export const ActorSQLDatabaseMixin = (database: Knex): SQLActorDatabase => ({
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
    const currentTime = new Date()

    const settings: ActorSettings = {
      iconUrl,
      headerImageUrl,
      followersUrl,
      inboxUrl,
      sharedInboxUrl
    }
    await database('actors').insert({
      id: actorId,
      username,
      domain,
      name,
      summary,
      settings: JSON.stringify(settings),
      publicKey,
      privateKey,
      createdAt: new Date(createdAt),
      updatedAt: currentTime
    })
    return this.getActorFromId({ id: actorId })
  },

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
    const currentTime = new Date()

    const settings: ActorSettings = {
      iconUrl,
      headerImageUrl,
      followersUrl,
      inboxUrl,
      sharedInboxUrl
    }
    await database('actors').insert({
      id: actorId,
      username,
      domain,
      name,
      summary,
      settings: JSON.stringify(settings),
      publicKey,
      privateKey,
      createdAt: new Date(createdAt),
      updatedAt: currentTime
    })
    return this.getMastodonActor(actorId)
  },

  async getActorFromEmail({ email }: GetActorFromEmailParams) {
    const persistedActor = await database('actors')
      .select<SQLActor>('actors.*')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first()
    if (!persistedActor) return undefined

    const [account, totalFollowers, totalFollowing, totalStatus, lastStatus] =
      await database.transaction(async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          trx('follows')
            .where('targetActorId', persistedActor.id)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first(),
          trx('follows')
            .where('actorId', persistedActor.id)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first(),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .count<{ count: string }>('id as count')
            .first(),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      })

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      parseInt(totalFollowing?.count ?? '0', 10),
      parseInt(totalFollowers?.count ?? '0', 10),
      parseInt(totalStatus?.count ?? '0', 10),
      getCompatibleTime(lastStatusCreatedAt),
      account
    )
  },

  async getMastodonActorFromEmail({ email }: GetActorFromEmailParams) {
    const result = await database('actors')
      .select('actors.id')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first<{ id: string }>()
    if (!result) return null
    return this.getMastodonActor(result.id)
  },

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams) {
    const result = await database('follows')
      .where('actorId', currentActorId)
      .andWhere('targetActorId', followingActorId)
      .andWhere('status', 'Accepted')
      .count<{ count: string }>('id as count')
      .first()
    return parseInt(result?.count ?? '0', 10) > 0
  },

  async getActorFromUsername({ username, domain }: GetActorFromUsernameParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .first()
    if (!persistedActor) return undefined

    const [account, totalFollowers, totalFollowing, totalStatus, lastStatus] =
      await database.transaction(async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          trx('follows')
            .where('targetActorId', persistedActor.id)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first(),
          trx('follows')
            .where('actorId', persistedActor.id)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first(),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .count<{ count: string }>('id as count')
            .first(),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      })

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      parseInt(totalFollowing?.count ?? '0', 10),
      parseInt(totalFollowers?.count ?? '0', 10),
      parseInt(totalStatus?.count ?? '0', 10),
      getCompatibleTime(lastStatusCreatedAt),
      account
    )
  },

  async getMastodonActorFromUsername({
    username,
    domain
  }: GetActorFromUsernameParams) {
    const result = await database<SQLActor>('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .select('id')
      .first<{ id: string }>()
    if (!result) return null

    return this.getMastodonActor(result.id)
  },

  async getActorFromId({ id }: GetActorFromIdParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', id)
      .first()
    if (!persistedActor) return undefined

    if (!persistedActor.accountId) {
      const [totalFollowers, totalFollowing, totalStatus, lastStatus] =
        await database.transaction(async (trx) => {
          return Promise.all([
            trx('follows')
              .where('targetActorId', persistedActor.id)
              .andWhere('status', 'Accepted')
              .count<{ count: string }>('* as count')
              .first(),
            trx('follows')
              .where('actorId', persistedActor.id)
              .andWhere('status', 'Accepted')
              .count<{ count: string }>('* as count')
              .first(),
            trx('statuses')
              .where('actorId', persistedActor.id)
              .count<{ count: string }>('id as count')
              .first(),
            trx('statuses')
              .where('actorId', persistedActor.id)
              .orderBy('createdAt', 'desc')
              .first<{ createdAt: number | Date }>('createdAt')
          ])
        })

      const lastStatusCreatedAt = lastStatus?.createdAt
        ? lastStatus.createdAt
        : 0
      return this.getActor(
        persistedActor,
        parseInt(totalFollowing?.count ?? '0', 10),
        parseInt(totalFollowers?.count ?? '0', 10),
        parseInt(totalStatus?.count ?? '0', 10),
        getCompatibleTime(lastStatusCreatedAt)
      )
    }

    const [account, totalFollowers, totalFollowing, totalStatus, lastStatus] =
      await database.transaction(async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          trx('follows')
            .where('targetActorId', persistedActor.id)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first(),
          trx('follows')
            .where('actorId', persistedActor.id)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first(),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .count<{ count: string }>('id as count')
            .first(),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      })

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      parseInt(totalFollowing?.count ?? '0', 10),
      parseInt(totalFollowers?.count ?? '0', 10),
      parseInt(totalStatus?.count ?? '0', 10),
      getCompatibleTime(lastStatusCreatedAt),
      account
    )
  },

  async getMastodonActorFromId({ id }: GetActorFromIdParams) {
    return this.getMastodonActor(id)
  },

  getActor(
    sqlActor: SQLActor,
    followingCount: number,
    followersCount: number,
    statusCount: number,
    lastStatusAt: number,
    sqlAccount?: SQLAccount
  ): Actor {
    const settings = getCompatibleJSON(sqlActor.settings)
    const account = sqlAccount
      ? {
          account: Account.parse({
            ...sqlAccount,
            createdAt: getCompatibleTime(sqlAccount.createdAt),
            updatedAt: getCompatibleTime(sqlAccount.updatedAt),
            ...{
              verifiedAt: sqlAccount.verifiedAt
                ? getCompatibleTime(sqlAccount.verifiedAt)
                : null
            }
          })
        }
      : null
    return Actor.parse({
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
      ...account,

      followingCount,
      followersCount,

      statusCount,
      lastStatusAt,

      createdAt: getCompatibleTime(sqlActor.createdAt),
      updatedAt: getCompatibleTime(sqlActor.updatedAt)
    })
  },

  async getMastodonActor(actorId: string) {
    const sqlActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!sqlActor) return null

    const [lastStatus, totalStatus, totalFollowers, totalFollowing] =
      await database.transaction(async (trx) =>
        Promise.all([
          trx('statuses')
            .where('actorId', actorId)
            .orderBy('createdAt', 'desc')
            .select('createdAt')
            .first<{ createdAt: number | Date }>(),
          trx('statuses')
            .where('actorId', actorId)
            .count<{ count: string }>('* as count')
            .first(),
          trx('follows')
            .where('targetActorId', actorId)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first(),
          trx('follows')
            .where('actorId', actorId)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first()
        ])
      )

    const settings = getCompatibleJSON(sqlActor.settings)
    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return Mastodon.Account.parse({
      id: sqlActor.id,
      username: sqlActor.username,
      acct: `${sqlActor.username}@${sqlActor.domain}`,
      url: sqlActor.id,
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

      created_at: getISOTimeUTC(getCompatibleTime(sqlActor.createdAt)),
      last_status_at: lastStatusCreatedAt
        ? getISOTimeUTC(getCompatibleTime(lastStatusCreatedAt))
        : null,

      followers_count: parseInt(totalFollowers?.count ?? '0', 10),
      following_count: parseInt(totalFollowing?.count ?? '0', 10),
      statuses_count: parseInt(totalStatus?.count ?? '0', 10)
    })
  },

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
    const persistedActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!persistedActor) return undefined

    const persistedSettings = getCompatibleJSON(persistedActor.settings)
    const settings: ActorSettings = {
      ...persistedSettings,
      ...(iconUrl ? { iconUrl } : null),
      ...(headerImageUrl ? { headerImageUrl } : null),
      ...(appleSharedAlbumToken ? { appleSharedAlbumToken } : null),

      ...(followersUrl ? { followersUrl } : null),
      ...(inboxUrl ? { inboxUrl } : null),
      ...(sharedInboxUrl ? { sharedInboxUrl } : null)
    }

    await database<SQLActor>('actors')
      .where('id', actorId)
      .update({
        ...(name ? { name } : null),
        ...(summary ? { summary } : null),

        ...(publicKey ? { publicKey } : null),

        settings: JSON.stringify(settings),
        updatedAt: new Date()
      })
    return this.getActorFromId({ id: actorId })
  },

  async deleteActor({ actorId }: DeleteActorParams) {
    await database('actors').where('id', actorId).delete()
  },

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    const result = await database('follows')
      .where('actorId', actorId)
      .andWhere('status', 'Accepted')
      .count<{ count: string }>('* as count')
      .first()
    return parseInt(result?.count ?? '0', 10)
  },

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    const result = await database('follows')
      .where('targetActorId', actorId)
      .andWhere('status', 'Accepted')
      .count<{ count: string }>('* as count')
      .first()
    return parseInt(result?.count ?? '0', 10)
  },

  async isInternalActor({ actorId }: IsInternalActorParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!persistedActor) return false
    return Boolean(persistedActor.accountId)
  }
})
