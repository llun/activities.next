import { Mastodon } from '@llun/activities.schema'
import { Knex } from 'knex'

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

export type GetActorFunction = (
  sqlActor: SQLActor,
  followingCount: number,
  followersCount: number,
  statusCount: number,
  lastStatusAt: number,
  sqlAccount?: SQLAccount
) => Actor
export type GetMastodonActorFunction = (
  actorId: string
) => Promise<Mastodon.Account | null>

export const ActorSQLStorageMixin = (
  database: Knex,
  getActor: GetActorFunction,
  getMastodonActor: GetMastodonActorFunction
): ActorDatabase => ({
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
    return getMastodonActor(actorId)
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
    return getActor(
      persistedActor,
      parseInt(totalFollowing?.count ?? '0', 10),
      parseInt(totalFollowers?.count ?? '0', 10),
      parseInt(totalStatus?.count ?? '0', 10),
      typeof lastStatusCreatedAt === 'number'
        ? lastStatusCreatedAt
        : lastStatusCreatedAt.getTime(),
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
    return getMastodonActor(result.id)
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
    return getActor(
      persistedActor,
      parseInt(totalFollowing?.count ?? '0', 10),
      parseInt(totalFollowers?.count ?? '0', 10),
      parseInt(totalStatus?.count ?? '0', 10),
      typeof lastStatusCreatedAt === 'number'
        ? lastStatusCreatedAt
        : lastStatusCreatedAt.getTime(),
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

    return getMastodonActor(result.id)
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
      return getActor(
        persistedActor,
        parseInt(totalFollowing?.count ?? '0', 10),
        parseInt(totalFollowers?.count ?? '0', 10),
        parseInt(totalStatus?.count ?? '0', 10),
        typeof lastStatusCreatedAt === 'number'
          ? lastStatusCreatedAt
          : lastStatusCreatedAt.getTime()
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
    return getActor(
      persistedActor,
      parseInt(totalFollowing?.count ?? '0', 10),
      parseInt(totalFollowers?.count ?? '0', 10),
      parseInt(totalStatus?.count ?? '0', 10),
      typeof lastStatusCreatedAt === 'number'
        ? lastStatusCreatedAt
        : lastStatusCreatedAt.getTime(),
      account
    )
  },

  async getMastodonActorFromId({ id }: GetActorFromIdParams) {
    return getMastodonActor(id)
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

    const storageSettings =
      typeof persistedActor.settings === 'string'
        ? (JSON.parse(persistedActor.settings) as ActorSettings)
        : persistedActor.settings

    const settings: ActorSettings = {
      ...storageSettings,
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
        updatedAt: Date.now()
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
