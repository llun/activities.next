import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreatePushSubscriptionParams,
  DeletePushSubscriptionParams,
  GetPushSubscriptionsForActorParams,
  PushSubscription,
  PushSubscriptionDatabase
} from '@/lib/types/database/operations'

interface SQLPushSubscription {
  id: string
  actorId: string
  endpoint: string
  p256dh: string
  auth: string
  createdAt: number | Date
  updatedAt: number | Date
}

const fixPushSubscriptionDates = (
  row: SQLPushSubscription
): PushSubscription => ({
  ...row,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const PushSubscriptionSQLDatabaseMixin = (
  database: Knex
): PushSubscriptionDatabase => ({
  async createPushSubscription({
    actorId,
    endpoint,
    p256dh,
    auth
  }: CreatePushSubscriptionParams): Promise<PushSubscription> {
    const id = randomUUID()
    const now = new Date()

    await database('push_subscriptions')
      .insert({
        id,
        actorId,
        endpoint,
        p256dh,
        auth,
        createdAt: now,
        updatedAt: now
      })
      .onConflict('endpoint')
      .merge({ actorId, p256dh, auth, updatedAt: now })

    const row = await database<SQLPushSubscription>('push_subscriptions')
      .where({ endpoint })
      .first()

    return fixPushSubscriptionDates(row!)
  },

  async deletePushSubscription({
    endpoint,
    actorId
  }: DeletePushSubscriptionParams): Promise<void> {
    await database('push_subscriptions').where({ endpoint, actorId }).delete()
  },

  async getPushSubscriptionsForActor({
    actorId
  }: GetPushSubscriptionsForActorParams): Promise<PushSubscription[]> {
    const rows = await database<SQLPushSubscription>(
      'push_subscriptions'
    ).where({ actorId })
    return rows.map(fixPushSubscriptionDates)
  },

  async deletePushSubscriptionsForActor({
    actorId
  }: {
    actorId: string
  }): Promise<void> {
    await database('push_subscriptions').where({ actorId }).delete()
  }
})
