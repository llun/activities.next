import { Mastodon } from '@llun/activities.schema'
import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  ActorDatabase,
  CancelActorDeletionParams,
  CreateActorParams,
  DeleteActorDataParams,
  DeleteActorParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  GetActorSettingsParams,
  GetActorsScheduledForDeletionParams,
  IsCurrentActorFollowingParams,
  IsInternalActorParams,
  ScheduleActorDeletionParams,
  StartActorDeletionParams,
  UpdateActorParams
} from '@/lib/database/types/actor'
import { ActorSettings, SQLAccount, SQLActor } from '@/lib/database/types/sql'
import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

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
          trx('counters')
            .where('id', `total-status:${persistedActor.id}`)
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
      totalStatus?.value ?? 0,
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
          trx('counters')
            .where('id', `total-status:${persistedActor.id}`)
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
      totalStatus?.value ?? 0,
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
            trx('counters')
              .where('id', `total-status:${persistedActor.id}`)
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
        totalStatus?.value ?? 0,
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
          trx('counters')
            .where('id', `total-status:${persistedActor.id}`)
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
      totalStatus?.value ?? 0,
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
            },
            ...{
              emailVerifiedAt: sqlAccount.emailVerifiedAt
                ? getCompatibleTime(sqlAccount.emailVerifiedAt)
                : null
            },
            ...{
              emailChangeCodeExpiresAt: sqlAccount.emailChangeCodeExpiresAt
                ? getCompatibleTime(sqlAccount.emailChangeCodeExpiresAt)
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
      manuallyApprovesFollowers: settings.manuallyApprovesFollowers ?? true,
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
      updatedAt: getCompatibleTime(sqlActor.updatedAt),
      deletionStatus: sqlActor.deletionStatus ?? null,
      deletionScheduledAt: sqlActor.deletionScheduledAt
        ? getCompatibleTime(sqlActor.deletionScheduledAt)
        : null
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
          trx('counters').where('id', `total-status:${actorId}`).first(),
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
      id: urlToId(sqlActor.id),
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

      locked: settings.manuallyApprovesFollowers ?? true,
      bot: false,
      group: false,
      discoverable: true,
      noindex: false,

      source: {
        note: '',
        fields: [],
        privacy: 'public',
        sensitive: false,
        language: 'en',
        follow_requests_count: 0
      },

      created_at: getISOTimeUTC(getCompatibleTime(sqlActor.createdAt)),
      last_status_at: lastStatusCreatedAt
        ? getISOTimeUTC(getCompatibleTime(lastStatusCreatedAt), true)
        : null,

      followers_count: parseInt(totalFollowers?.count ?? '0', 10),
      following_count: parseInt(totalFollowing?.count ?? '0', 10),
      statuses_count: totalStatus?.value ?? 0
    })
  },

  async updateActor({
    actorId,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    manuallyApprovesFollowers,
    emailNotifications,

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
      ...(manuallyApprovesFollowers !== undefined
        ? { manuallyApprovesFollowers }
        : null),
      ...(emailNotifications !== undefined ? { emailNotifications } : null),

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
  },

  async getActorSettings({ actorId }: GetActorSettingsParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .select('settings')
      .first()
    if (!persistedActor) return undefined
    return getCompatibleJSON(persistedActor.settings) as ActorSettings
  },

  async scheduleActorDeletion({
    actorId,
    scheduledAt
  }: ScheduleActorDeletionParams) {
    const currentTime = new Date()
    await database<SQLActor>('actors').where('id', actorId).update({
      deletionStatus: 'scheduled',
      deletionScheduledAt: scheduledAt,
      updatedAt: currentTime
    })
  },

  async cancelActorDeletion({ actorId }: CancelActorDeletionParams) {
    const currentTime = new Date()
    await database<SQLActor>('actors').where('id', actorId).update({
      deletionStatus: null,
      deletionScheduledAt: null,
      updatedAt: currentTime
    })
  },

  async startActorDeletion({ actorId }: StartActorDeletionParams) {
    const currentTime = new Date()
    await database<SQLActor>('actors').where('id', actorId).update({
      deletionStatus: 'deleting',
      updatedAt: currentTime
    })
  },

  async getActorsScheduledForDeletion({
    beforeDate
  }: GetActorsScheduledForDeletionParams) {
    const sqlActors = await database<SQLActor>('actors')
      .where('deletionStatus', 'scheduled')
      .andWhere('deletionScheduledAt', '<=', beforeDate)

    const results: Actor[] = []
    for (const sqlActor of sqlActors) {
      const actor = await this.getActorFromId({ id: sqlActor.id })
      if (actor) {
        results.push(actor)
      }
    }
    return results
  },

  async getActorDeletionStatus({ id }: GetActorFromIdParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', id)
      .select('deletionStatus', 'deletionScheduledAt')
      .first()
    if (!persistedActor) return undefined
    return {
      status: persistedActor.deletionStatus ?? null,
      scheduledAt: persistedActor.deletionScheduledAt
        ? getCompatibleTime(persistedActor.deletionScheduledAt)
        : null
    }
  },

  async deleteActorData({ actorId }: DeleteActorDataParams) {
    await database.transaction(async (trx) => {
      // Get all status IDs for this actor to delete related data
      const statuses = await trx('statuses')
        .where('actorId', actorId)
        .select('id')

      const statusIds = statuses.map((s) => s.id)

      if (statusIds.length > 0) {
        // Get poll choice IDs before deleting them
        const pollChoices = await trx('poll_choices')
          .whereIn('statusId', statusIds)
          .select('choiceId')
        const choiceIds = pollChoices.map((c) => c.choiceId)

        // Delete status-related data
        await trx('tags').whereIn('statusId', statusIds).delete()
        await trx('recipients').whereIn('statusId', statusIds).delete()
        await trx('likes').whereIn('statusId', statusIds).delete()
        await trx('attachments').whereIn('statusId', statusIds).delete()
        await trx('status_history').whereIn('statusId', statusIds).delete()

        // Delete poll answers before deleting poll choices
        if (choiceIds.length > 0) {
          await trx('poll_answers').whereIn('answerId', choiceIds).delete()
        }
        await trx('poll_choices').whereIn('statusId', statusIds).delete()
      }

      // Delete timeline entries for this actor
      await trx('timelines').where('actorId', actorId).delete()
      await trx('timelines').where('statusActorId', actorId).delete()

      // Delete statuses
      await trx('statuses').where('actorId', actorId).delete()

      // Delete follows (both directions)
      await trx('follows').where('actorId', actorId).delete()
      await trx('follows').where('targetActorId', actorId).delete()

      // Delete likes made by this actor
      await trx('likes').where('actorId', actorId).delete()

      // Delete attachments created by this actor
      await trx('attachments').where('actorId', actorId).delete()

      // Delete medias created by this actor
      await trx('medias').where('actorId', actorId).delete()

      // Delete counters for this actor
      await trx('counters').where('id', `total-status:${actorId}`).delete()

      // Delete notifications table entries if exists
      try {
        await trx('notifications').where('actorId', actorId).delete()
        await trx('notifications').where('sourceActorId', actorId).delete()
      } catch {
        // Table might not exist in older migrations
      }

      // Finally delete the actor
      await trx('actors').where('id', actorId).delete()
    })
  }
})
