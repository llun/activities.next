import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { toDomainAccount } from '@/lib/database/sql/utils/toDomainAccount'
import {
  AdminDatabase,
  GetAccountWithActorsParams,
  GetAllAccountsParams
} from '@/lib/types/database/operations'
import { ActorSettings, SQLAccount, SQLActor } from '@/lib/types/database/rows'
import { Actor } from '@/lib/types/domain/actor'

const toDomainActor = (row: SQLActor): Actor => {
  const settings = getCompatibleJSON<ActorSettings>(row.settings)
  return Actor.parse({
    id: row.id,
    username: row.username,
    domain: row.domain,
    name: row.name,
    summary: row.summary,
    iconUrl: settings?.iconUrl,
    headerImageUrl: settings?.headerImageUrl,
    followersUrl: settings?.followersUrl ?? '',
    inboxUrl: settings?.inboxUrl ?? '',
    sharedInboxUrl: settings?.sharedInboxUrl ?? '',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    publicKey: row.publicKey,
    privateKey: row.privateKey,
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt),
    deletionStatus: row.deletionStatus ?? null,
    deletionScheduledAt: row.deletionScheduledAt
      ? getCompatibleTime(row.deletionScheduledAt)
      : null
  })
}

export const AdminSQLDatabaseMixin = (database: Knex): AdminDatabase => ({
  async getAllAccounts({ limit, offset }: GetAllAccountsParams) {
    const [rows, countResult] = await Promise.all([
      database('accounts')
        .select('*')
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
    const accountRow = await database('accounts').where('id', accountId).first()
    if (!accountRow) return null

    const actorRows = await database('actors')
      .where('accountId', accountId)
      .orderBy('createdAt', 'asc')

    return {
      account: toDomainAccount(accountRow as SQLAccount),
      actors: (actorRows as SQLActor[]).map(toDomainActor)
    }
  },

  async getServiceStats() {
    const [
      accountsCount,
      actorsCount,
      statusesCount,
      mediaResult,
      mediaFilesResult,
      fitnessResult,
      fitnessFilesResult
    ] = await Promise.all([
      database('accounts').count<{ count: string }>('id as count').first(),
      database('actors')
        .whereNotNull('accountId')
        .count<{ count: string }>('id as count')
        .first(),
      database('statuses').count<{ count: string }>('id as count').first(),
      database('counters')
        .where('id', 'like', 'media-usage:%')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'total-media:%')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'fitness-usage:%')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'total-fitness:%')
        .sum<{ total: string }>('value as total')
        .first()
    ])

    return {
      totalAccounts: parseInt(accountsCount?.count ?? '0', 10),
      totalActors: parseInt(actorsCount?.count ?? '0', 10),
      totalStatuses: parseInt(statusesCount?.count ?? '0', 10),
      totalMediaBytes: parseInt(mediaResult?.total ?? '0', 10),
      totalMediaFiles: parseInt(mediaFilesResult?.total ?? '0', 10),
      totalFitnessBytes: parseInt(fitnessResult?.total ?? '0', 10),
      totalFitnessFiles: parseInt(fitnessFilesResult?.total ?? '0', 10)
    }
  }
})
