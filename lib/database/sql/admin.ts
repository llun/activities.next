import { Knex } from 'knex'

import {
  CounterKey,
  getCounterValues,
  parseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getBucketStats } from '@/lib/database/sql/utils/counterBucket'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { toDomainAccount } from '@/lib/database/sql/utils/toDomainAccount'
import {
  AdminDatabase,
  AdminHashtag,
  GetAccountWithActorsParams,
  GetAllAccountsParams,
  GetAllHashtagsParams,
  GetServiceStatsBucketsParams,
  HashtagSortOrder
} from '@/lib/types/database/operations'
import { ActorSettings, SQLAccount, SQLActor } from '@/lib/types/database/rows'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const toDomainActor = (row: SQLActor): Actor => {
  const settings = getCompatibleJSON<ActorSettings>(row.settings)
  return Actor.parse({
    id: row.id,
    username: row.username,
    domain: row.domain,
    name: row.name ?? undefined,
    summary: row.summary ?? undefined,
    iconUrl: settings?.iconUrl,
    headerImageUrl: settings?.headerImageUrl,
    manuallyApprovesFollowers: settings?.manuallyApprovesFollowers ?? true,
    followersUrl: settings?.followersUrl ?? '',
    inboxUrl: settings?.inboxUrl ?? '',
    sharedInboxUrl: settings?.sharedInboxUrl ?? '',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    publicKey: row.publicKey,
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt),
    deletionStatus: row.deletionStatus ?? null,
    deletionScheduledAt:
      row.deletionScheduledAt != null
        ? getCompatibleTime(row.deletionScheduledAt)
        : null
  })
}

export const AdminSQLDatabaseMixin = (database: Knex): AdminDatabase => ({
  async getAllAccounts({ limit, offset }: GetAllAccountsParams) {
    const [rows, countResult] = await Promise.all([
      database<SQLAccount>('accounts')
        .select(
          'id',
          'email',
          'name',
          'iconUrl',
          'role',
          'createdAt',
          'updatedAt',
          'verifiedAt'
        )
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset),
      database('accounts').count<{ count: string }>('id as count').first()
    ])

    return {
      accounts: (rows as SQLAccount[]).map(toDomainAccount),
      total: parseInt(countResult?.count ?? '0', 10)
    }
  },

  async getAccountWithActors({ accountId }: GetAccountWithActorsParams) {
    const accountRow = await database<SQLAccount>('accounts')
      .select(
        'id',
        'email',
        'name',
        'iconUrl',
        'role',
        'createdAt',
        'updatedAt',
        'verifiedAt'
      )
      .where('id', accountId)
      .first()
    if (!accountRow) return null

    const actorRows = await database<SQLActor>('actors')
      .select(
        'id',
        'username',
        'domain',
        'name',
        'summary',
        'accountId',
        'publicKey',
        'settings',
        'deletionStatus',
        'deletionScheduledAt',
        'createdAt',
        'updatedAt'
      )
      .where('accountId', accountId)
      .orderBy('createdAt', 'asc')

    return {
      account: toDomainAccount(accountRow as SQLAccount),
      actors: (actorRows as SQLActor[]).map(toDomainActor)
    }
  },

  async getServiceStats() {
    const [
      counterMap,
      mediaResult,
      mediaFilesResult,
      fitnessResult,
      fitnessFilesResult
    ] = await Promise.all([
      getCounterValues(database, [
        CounterKey.serviceTotalAccounts(),
        CounterKey.serviceTotalActors(),
        CounterKey.serviceTotalStatuses()
      ]),
      database('counters')
        .where('id', 'like', 'media-usage:%')
        .whereNull('bucketHour')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'total-media:%')
        .whereNull('bucketHour')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'fitness-usage:%')
        .whereNull('bucketHour')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'total-fitness:%')
        .whereNull('bucketHour')
        .sum<{ total: string }>('value as total')
        .first()
    ])

    return {
      totalAccounts: parseCounterValue(
        counterMap[CounterKey.serviceTotalAccounts()]
      ),
      totalActors: parseCounterValue(
        counterMap[CounterKey.serviceTotalActors()]
      ),
      totalStatuses: parseCounterValue(
        counterMap[CounterKey.serviceTotalStatuses()]
      ),
      totalMediaBytes: parseInt(mediaResult?.total ?? '0', 10),
      totalMediaFiles: parseInt(mediaFilesResult?.total ?? '0', 10),
      totalFitnessBytes: parseInt(fitnessResult?.total ?? '0', 10),
      totalFitnessFiles: parseInt(fitnessFilesResult?.total ?? '0', 10)
    }
  },

  async getServiceStatsBuckets({
    counterType,
    startTime,
    endTime
  }: GetServiceStatsBucketsParams) {
    const rows = await getBucketStats(
      database,
      counterType,
      new Date(startTime),
      new Date(endTime)
    )
    return rows.map((row) => ({
      bucketHour: row.bucketHour.getTime(),
      value: row.value
    }))
  },

  async getAllHashtags({ limit, offset, sort }: GetAllHashtagsParams) {
    // baseQuery holds only the shared joins and filters; aggregations are
    // applied separately so the count query doesn't duplicate this logic.
    const baseQuery = () =>
      database('tags')
        .innerJoin('statuses', 'tags.statusId', 'statuses.id')
        .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
        .where('tags.type', 'hashtag')
        .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
        .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])

    const orderColumns: Record<
      HashtagSortOrder,
      { column: string; order: string }[]
    > = {
      alphabetical: [{ column: 'tags.nameNormalized', order: 'asc' }],
      recent: [
        { column: 'latestPostAt', order: 'desc' },
        { column: 'tags.nameNormalized', order: 'asc' }
      ],
      count: [
        { column: 'postCount', order: 'desc' },
        { column: 'tags.nameNormalized', order: 'asc' }
      ]
    }

    const [rows, countResult] = await Promise.all([
      baseQuery()
        .groupBy('tags.nameNormalized')
        .select('tags.nameNormalized')
        .countDistinct({ postCount: 'tags.statusId' })
        .max({ latestPostAt: 'statuses.createdAt' })
        .orderBy(orderColumns[sort])
        .limit(limit)
        .offset(offset),
      baseQuery()
        .countDistinct<{ count: string }>({ count: 'tags.nameNormalized' })
        .first()
    ])

    const hashtags: AdminHashtag[] = (
      rows as {
        nameNormalized: string
        postCount: string
        latestPostAt: Date | string | number | null
      }[]
    ).map((row) => ({
      // Preserve the full nameNormalized value as `name` so that routing
      // is fully reversible. The display layer strips the leading '#'.
      name: row.nameNormalized,
      postCount: parseInt(String(row.postCount), 10),
      latestPostAt:
        row.latestPostAt != null ? new Date(row.latestPostAt).getTime() : null
    }))

    return {
      hashtags,
      total: parseInt(String(countResult?.count ?? '0'), 10)
    }
  }
})
