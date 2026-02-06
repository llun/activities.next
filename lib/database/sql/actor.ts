import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  deleteCounterValue,
  getCounterValue,
  getCounterValues,
  increaseCounterValue,
  parseCounterValue,
  setCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { Mastodon } from '@/lib/types/activitypub'
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
} from '@/lib/types/database/operations'
import { ActorSettings, SQLAccount, SQLActor } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
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

const getActorCounterSummary = async (
  trx: Knex.Transaction,
  actorId: string
): Promise<{
  followersCount: number
  followingCount: number
  statusCount: number
}> => {
  const counters = await getCounterValues(trx, [
    CounterKey.totalFollowers(actorId),
    CounterKey.totalFollowing(actorId),
    CounterKey.totalStatus(actorId)
  ])

  return {
    followersCount: counters[CounterKey.totalFollowers(actorId)] ?? 0,
    followingCount: counters[CounterKey.totalFollowing(actorId)] ?? 0,
    statusCount: counters[CounterKey.totalStatus(actorId)] ?? 0
  }
}

const parseStatusContent = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
): string | Record<string, unknown> | null => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      return getCompatibleJSON(content)
    } catch {
      return content
    }
  }
  return content
}

const getStatusUrlHash = (url: string): string => getHashFromString(url)

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
    if (!persistedActor) return null

    const [account, counters, lastStatus] = await database.transaction(
      async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          getActorCounterSummary(trx, persistedActor.id),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      }
    )

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
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
    if (!persistedActor) return null

    const [account, counters, lastStatus] = await database.transaction(
      async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          getActorCounterSummary(trx, persistedActor.id),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      }
    )

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
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
    if (!persistedActor) return null

    if (!persistedActor.accountId) {
      const [counters, lastStatus] = await database.transaction(async (trx) => {
        return Promise.all([
          getActorCounterSummary(trx, persistedActor.id),
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
        counters.followingCount,
        counters.followersCount,
        counters.statusCount,
        getCompatibleTime(lastStatusCreatedAt)
      )
    }

    const [account, counters, lastStatus] = await database.transaction(
      async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          getActorCounterSummary(trx, persistedActor.id),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      }
    )

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
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

    const [lastStatus, counters] = await database.transaction(async (trx) =>
      Promise.all([
        trx('statuses')
          .where('actorId', actorId)
          .orderBy('createdAt', 'desc')
          .select('createdAt')
          .first<{ createdAt: number | Date }>(),
        getActorCounterSummary(trx, actorId)
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

      followers_count: counters.followersCount,
      following_count: counters.followingCount,
      statuses_count: counters.statusCount
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
    fitness,

    publicKey,

    followersUrl,
    inboxUrl,
    sharedInboxUrl
  }: UpdateActorParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!persistedActor) return null

    const persistedSettings = getCompatibleJSON(persistedActor.settings)
    const settings: ActorSettings = {
      ...persistedSettings,
      ...(iconUrl ? { iconUrl } : null),
      ...(headerImageUrl ? { headerImageUrl } : null),
      ...(manuallyApprovesFollowers !== undefined
        ? { manuallyApprovesFollowers }
        : null),
      ...(emailNotifications !== undefined ? { emailNotifications } : null),
      ...(fitness !== undefined ? { fitness } : null),

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

  async updateActorFollowersCount(actorId: string) {
    const result = await database('follows')
      .where('targetActorId', actorId)
      .andWhere('status', 'Accepted')
      .count<{ count: string }>('* as count')
      .first()
    await setCounterValue(
      database,
      CounterKey.totalFollowers(actorId),
      parseInt(result?.count ?? '0', 10)
    )
  },

  async updateActorFollowingCount(actorId: string) {
    const result = await database('follows')
      .where('actorId', actorId)
      .andWhere('status', 'Accepted')
      .count<{ count: string }>('* as count')
      .first()
    await setCounterValue(
      database,
      CounterKey.totalFollowing(actorId),
      parseInt(result?.count ?? '0', 10)
    )
  },

  async increaseActorStatusCount(actorId: string, amount: number = 1) {
    await increaseCounterValue(
      database,
      CounterKey.totalStatus(actorId),
      amount
    )
  },

  async decreaseActorStatusCount(actorId: string, amount: number = 1) {
    await decreaseCounterValue(
      database,
      CounterKey.totalStatus(actorId),
      amount
    )
  },

  async updateActorLastStatusAt(_actorId: string, _time: number) {
    // `lastStatusAt` is derived from statuses and not persisted on actors.
  },

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    return getCounterValue(database, CounterKey.totalFollowing(actorId))
  },

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    return getCounterValue(database, CounterKey.totalFollowers(actorId))
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
      const currentTime = new Date()

      const persistedActor = await trx('actors')
        .where('id', actorId)
        .first<{ accountId: string | null }>('accountId')

      const actorStatuses = await trx('statuses')
        .where('actorId', actorId)
        .select('id', 'type', 'reply', 'content')

      const statusIds = actorStatuses.map((status) => status.id)
      const statusReferenceToId = new Map<string, string>()
      const replyReferences = Array.from(
        new Set(
          actorStatuses
            .map((status) => status.reply)
            .filter((reply): reply is string => Boolean(reply))
        )
      )
      if (replyReferences.length > 0) {
        const replyReferenceHashes = Array.from(
          new Set(replyReferences.map((reply) => getStatusUrlHash(reply)))
        )
        const parentStatuses = await trx('statuses')
          .whereIn('id', replyReferences)
          .orWhere((builder) =>
            builder
              .whereIn('urlHash', replyReferenceHashes)
              .whereIn('url', replyReferences)
          )
          .select('id', 'url')

        for (const parentStatus of parentStatuses) {
          statusReferenceToId.set(parentStatus.id, parentStatus.id)
          if (parentStatus.url) {
            statusReferenceToId.set(parentStatus.url, parentStatus.id)
          }
        }
      }

      if (actorStatuses.length > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalStatus(actorId),
          actorStatuses.length,
          currentTime
        )
      }

      const reblogCounterChanges: Record<string, number> = {}
      const replyCounterChanges: Record<string, number> = {}
      for (const status of actorStatuses) {
        if (status.type === 'Announce') {
          const content = parseStatusContent(status.content)
          const originalStatusId =
            typeof content === 'string'
              ? content
              : typeof content?.url === 'string'
                ? content.url
                : typeof status.content === 'string'
                  ? status.content
                  : null

          if (originalStatusId) {
            reblogCounterChanges[originalStatusId] =
              (reblogCounterChanges[originalStatusId] || 0) + 1
          }
        }

        if (status.reply) {
          const parentStatusId = statusReferenceToId.get(status.reply)
          if (parentStatusId) {
            replyCounterChanges[parentStatusId] =
              (replyCounterChanges[parentStatusId] || 0) + 1
          }
        }
      }

      for (const [statusId, count] of Object.entries(reblogCounterChanges)) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalReblog(statusId),
          count,
          currentTime
        )
      }
      for (const [statusId, count] of Object.entries(replyCounterChanges)) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalReply(statusId),
          count,
          currentTime
        )
      }

      const acceptedFollowing = await trx('follows')
        .where('actorId', actorId)
        .andWhere('status', 'Accepted')
        .select('targetActorId')

      if (acceptedFollowing.length > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalFollowing(actorId),
          acceptedFollowing.length,
          currentTime
        )

        const followerAdjustments: Record<string, number> = {}
        for (const follow of acceptedFollowing) {
          followerAdjustments[follow.targetActorId] =
            (followerAdjustments[follow.targetActorId] || 0) + 1
        }
        for (const [targetActorId, count] of Object.entries(
          followerAdjustments
        )) {
          await decreaseCounterValue(
            trx,
            CounterKey.totalFollowers(targetActorId),
            count,
            currentTime
          )
        }
      }

      const acceptedFollowers = await trx('follows')
        .where('targetActorId', actorId)
        .andWhere('status', 'Accepted')
        .select('actorId')
      if (acceptedFollowers.length > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalFollowers(actorId),
          acceptedFollowers.length,
          currentTime
        )

        const followingAdjustments: Record<string, number> = {}
        for (const follow of acceptedFollowers) {
          followingAdjustments[follow.actorId] =
            (followingAdjustments[follow.actorId] || 0) + 1
        }

        for (const [followerActorId, count] of Object.entries(
          followingAdjustments
        )) {
          await decreaseCounterValue(
            trx,
            CounterKey.totalFollowing(followerActorId),
            count,
            currentTime
          )
        }
      }

      const likesMadeByActor = await trx('likes')
        .where('actorId', actorId)
        .select('statusId')
      const likeAdjustments: Record<string, number> = {}
      for (const like of likesMadeByActor) {
        likeAdjustments[like.statusId] =
          (likeAdjustments[like.statusId] || 0) + 1
      }
      for (const [statusId, count] of Object.entries(likeAdjustments)) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalLike(statusId),
          count,
          currentTime
        )
      }

      const medias = await trx('medias')
        .where('actorId', actorId)
        .select('originalBytes', 'thumbnailBytes')
      const totalMediaBytes = medias.reduce(
        (sum, media) =>
          sum +
          parseCounterValue(media.originalBytes) +
          parseCounterValue(media.thumbnailBytes),
        0
      )
      if (persistedActor?.accountId && totalMediaBytes > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.mediaUsage(persistedActor.accountId),
          totalMediaBytes,
          currentTime
        )
      }

      if (statusIds.length > 0) {
        // Get poll choice IDs before deleting them
        const pollChoices = await trx('poll_choices')
          .whereIn('statusId', statusIds)
          .select('choiceId')
        const choiceIds = pollChoices.map((choice) => choice.choiceId)

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

      await deleteCounterValue(trx, CounterKey.totalStatus(actorId))
      await deleteCounterValue(trx, CounterKey.totalFollowers(actorId))
      await deleteCounterValue(trx, CounterKey.totalFollowing(actorId))

      for (const statusId of statusIds) {
        await deleteCounterValue(trx, CounterKey.totalLike(statusId))
        await deleteCounterValue(trx, CounterKey.totalReblog(statusId))
        await deleteCounterValue(trx, CounterKey.totalReply(statusId))
      }

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
