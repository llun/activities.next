import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import {
  CreateNotificationParams,
  GetNotificationRequestParams,
  GetNotificationRequestsParams,
  GetNotificationsCountParams,
  GetNotificationsParams,
  MarkNotificationsReadParams,
  Notification,
  NotificationDatabase,
  NotificationGroupKeyParams,
  NotificationRequest,
  ResolveNotificationRequestsParams,
  UpdateNotificationParams
} from '@/lib/types/database/operations'

const fixNotificationDataDate = (data: Notification): Notification => ({
  ...data,
  // SQLite stores booleans as 0/1; normalize to real booleans to honor the type.
  filtered: Boolean(data.filtered),
  isRead: Boolean(data.isRead),
  createdAt: getCompatibleTime(data.createdAt),
  updatedAt: getCompatibleTime(data.updatedAt),
  readAt: data.readAt ? getCompatibleTime(data.readAt) : undefined
})

// Match a group by its shared groupKey (e.g. 'like:<status>' or 'follow:<day>')
// or, for ungrouped notifications, by the notification id itself.
const applyGroupKeyMatch = (
  builder: Knex.QueryBuilder,
  groupKey: string
): Knex.QueryBuilder =>
  builder.where(function () {
    this.where('groupKey', groupKey).orWhere('id', groupKey)
  })

export const NotificationSQLDatabaseMixin = (
  database: Knex
): NotificationDatabase => ({
  async createNotification({
    actorId,
    type,
    sourceActorId,
    statusId,
    followId,
    groupKey,
    filtered = false
  }: CreateNotificationParams) {
    const currentTime = new Date()
    const notification: Notification = {
      id: crypto.randomUUID(),
      actorId,
      type,
      sourceActorId,
      statusId,
      followId,
      groupKey,
      isRead: false,
      filtered,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }

    await database('notifications').insert({
      ...notification,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    return notification
  },

  async getNotifications({
    actorId,
    limit,
    offset = 0,
    sourceActorId,
    types,
    excludeTypes,
    onlyUnread,
    ids,
    maxNotificationId,
    minNotificationId,
    sinceNotificationId,
    includeFiltered
  }: GetNotificationsParams) {
    let query = database('notifications').where('actorId', actorId).limit(limit)

    // By default hide policy-filtered notifications (they live in the requests
    // queue). Mastodon's `include_filtered` opts back into seeing them.
    if (!includeFiltered) {
      query = query.where('filtered', false)
    }

    if (sourceActorId) {
      query = query.where('sourceActorId', sourceActorId)
    }

    // Support cursor-based pagination
    // Scope cursor lookups to actorId to prevent information leaks
    // Use composite cursor (createdAt, id) to handle same-timestamp notifications
    if (maxNotificationId) {
      const maxNotification = await database('notifications')
        .where('id', maxNotificationId)
        .andWhere('actorId', actorId)
        .first()
      if (maxNotification) {
        // Get notifications older than cursor: (createdAt < cursor) OR (createdAt = cursor AND id < cursor)
        query = query.where(function () {
          this.where('createdAt', '<', maxNotification.createdAt).orWhere(
            function () {
              this.where('createdAt', '=', maxNotification.createdAt).andWhere(
                'id',
                '<',
                maxNotification.id
              )
            }
          )
        })
      }
    }

    if (minNotificationId || sinceNotificationId) {
      const minId = minNotificationId || sinceNotificationId
      const minNotification = await database('notifications')
        .where('id', minId)
        .andWhere('actorId', actorId)
        .first()
      // An unresolvable lower-bound cursor (dismissed/cleared/foreign id)
      // terminates pagination with an empty page — matching getListTimeline —
      // rather than dropping the filter and returning the wrong end of the
      // timeline (which, with the ascending min_id order below, would surface
      // the OLDEST notifications instead of an adjacent/empty page).
      if (!minNotification) return []
      // Get notifications newer than cursor: (createdAt > cursor) OR (createdAt = cursor AND id > cursor)
      query = query.where(function () {
        this.where('createdAt', '>', minNotification.createdAt).orWhere(
          function () {
            this.where('createdAt', '=', minNotification.createdAt).andWhere(
              'id',
              '>',
              minNotification.id
            )
          }
        )
      })
    }

    // Support offset-based pagination for backward compatibility
    if (!maxNotificationId && !minNotificationId && !sinceNotificationId) {
      query = query.offset(offset)
    }

    if (types && types.length > 0) {
      query = query.whereIn('type', types)
    }

    if (excludeTypes && excludeTypes.length > 0) {
      query = query.whereNotIn('type', excludeTypes)
    }

    if (onlyUnread) {
      query = query.where('isRead', false)
    }

    if (ids && ids.length > 0) {
      query = query.whereIn('id', ids)
    }

    // min_id ascends from the cursor — the OLDEST notifications just newer than
    // it — then reverses to the newest-first response shape, so it returns the
    // page adjacent to the cursor. since_id (and max_id / no cursor) keep the
    // newest-first DESC ordering (the newest slice above the cursor).
    const ascending = Boolean(minNotificationId)
    query = query
      .orderBy('createdAt', ascending ? 'asc' : 'desc')
      .orderBy('id', ascending ? 'asc' : 'desc')

    const results = await query
    const ordered = ascending ? results.reverse() : results
    return ordered.map(fixNotificationDataDate)
  },

  async getNotificationsCount({
    actorId,
    onlyUnread,
    types,
    excludeTypes,
    limit,
    includeFiltered,
    filteredOnly
  }: GetNotificationsCountParams) {
    let query = database('notifications').where('actorId', actorId)

    if (filteredOnly) {
      query = query.where('filtered', true)
    } else if (!includeFiltered) {
      query = query.where('filtered', false)
    }

    if (onlyUnread) {
      query = query.where('isRead', false)
    }

    if (types && types.length > 0) {
      query = query.whereIn('type', types)
    }

    if (excludeTypes && excludeTypes.length > 0) {
      query = query.whereNotIn('type', excludeTypes)
    }

    // Mastodon caps unread_count at a limit; emulate by counting rows from a
    // bounded subquery rather than the whole table.
    if (limit !== undefined) {
      // ORDER BY is intentionally omitted: for a COUNT the sort order does not
      // affect the result, and skipping it lets the query planner avoid a
      // potentially expensive sort before the LIMIT.
      const subquery = query.clone().select('id').limit(limit).as('capped')
      const result = await database
        .count<{ count: string }>('* as count')
        .from(subquery)
        .first()
      return parseInt(result?.count ?? '0', 10)
    }

    const result = await query.count<{ count: string }>('* as count').first()
    return parseInt(result?.count ?? '0', 10)
  },

  async markNotificationsRead({
    notificationIds
  }: MarkNotificationsReadParams) {
    if (notificationIds.length === 0) return

    const currentTime = new Date()
    await database('notifications').whereIn('id', notificationIds).update({
      isRead: true,
      readAt: currentTime,
      updatedAt: currentTime
    })
  },

  async updateNotification({
    notificationId,
    isRead,
    readAt
  }: UpdateNotificationParams) {
    const updates: {
      updatedAt: Date
      isRead?: boolean
      readAt?: Date | null
    } = {
      updatedAt: new Date()
    }

    if (isRead !== undefined) {
      updates.isRead = isRead
    }

    if (readAt !== undefined) {
      updates.readAt = new Date(readAt)
    }

    await database('notifications').where('id', notificationId).update(updates)
  },

  async getNotificationRequests({
    actorId,
    limit,
    offset = 0,
    maxCursor,
    sinceCursor
  }: GetNotificationRequestsParams) {
    let query = database('notifications')
      .where('actorId', actorId)
      .andWhere('filtered', true)
      .groupBy('sourceActorId')
      .select('sourceActorId')
      .count<
        {
          sourceActorId: string
          count: string | number
          firstCreatedAt: number | Date | string
          lastCreatedAt: number | Date | string
        }[]
      >('* as count')
      .min('createdAt as firstCreatedAt')
      .max('createdAt as lastCreatedAt')
      .orderBy('lastCreatedAt', 'desc')
      .orderBy('sourceActorId', 'asc')
      .limit(limit)

    if (maxCursor !== undefined) {
      // Groups older than cursor: (MAX(createdAt) < cursor) OR
      // (MAX(createdAt) = cursor AND sourceActorId > cursor.sourceActorId)
      query = query.havingRaw(
        'MAX(createdAt) < ? OR (MAX(createdAt) = ? AND sourceActorId > ?)',
        [
          new Date(maxCursor.updatedAt),
          new Date(maxCursor.updatedAt),
          maxCursor.sourceActorId
        ]
      )
    } else if (sinceCursor !== undefined) {
      // Groups newer than cursor: (MAX(createdAt) > cursor) OR
      // (MAX(createdAt) = cursor AND sourceActorId < cursor.sourceActorId)
      query = query.havingRaw(
        'MAX(createdAt) > ? OR (MAX(createdAt) = ? AND sourceActorId < ?)',
        [
          new Date(sinceCursor.updatedAt),
          new Date(sinceCursor.updatedAt),
          sinceCursor.sourceActorId
        ]
      )
    } else {
      query = query.offset(offset)
    }

    const groups = await query

    const requests = (
      await Promise.all(
        groups.map((group) =>
          buildNotificationRequest(
            database,
            actorId,
            group.sourceActorId,
            Number(group.count),
            group.firstCreatedAt,
            group.lastCreatedAt
          )
        )
      )
    ).filter((r): r is NotificationRequest => r !== null)
    return requests
  },

  async getNotificationRequest({
    actorId,
    sourceActorId
  }: GetNotificationRequestParams) {
    const group = await database('notifications')
      .where('actorId', actorId)
      .andWhere('filtered', true)
      .andWhere('sourceActorId', sourceActorId)
      .groupBy('sourceActorId')
      .select('sourceActorId')
      .count<
        {
          count: string | number
          firstCreatedAt: number | Date | string
          lastCreatedAt: number | Date | string
        }[]
      >('* as count')
      .min('createdAt as firstCreatedAt')
      .max('createdAt as lastCreatedAt')
      .first()
    if (!group) return null

    return buildNotificationRequest(
      database,
      actorId,
      sourceActorId,
      Number(group.count),
      group.firstCreatedAt,
      group.lastCreatedAt
    )
  },

  async getNotificationRequestsCount({ actorId }: { actorId: string }) {
    // Mastodon caps pending_requests_count at 100 in the policy summary.
    const MAX_REQUESTS_COUNT = 100
    const result = await database('notifications')
      .where('actorId', actorId)
      .andWhere('filtered', true)
      .countDistinct<{ count: string }>('sourceActorId as count')
      .first()
    return Math.min(parseInt(result?.count ?? '0', 10), MAX_REQUESTS_COUNT)
  },

  async acceptNotificationRequests({
    actorId,
    sourceActorIds
  }: ResolveNotificationRequestsParams) {
    if (sourceActorIds.length === 0) return
    const batchSize = getWhereInBatchSize(database)
    await Promise.all(
      chunkArray(sourceActorIds, batchSize).map((chunk) =>
        database('notifications')
          .where('actorId', actorId)
          .andWhere('filtered', true)
          .whereIn('sourceActorId', chunk)
          .update({ filtered: false, updatedAt: new Date() })
      )
    )
  },

  async dismissNotificationRequests({
    actorId,
    sourceActorIds
  }: ResolveNotificationRequestsParams) {
    if (sourceActorIds.length === 0) return
    const batchSize = getWhereInBatchSize(database)
    await Promise.all(
      chunkArray(sourceActorIds, batchSize).map((chunk) =>
        database('notifications')
          .where('actorId', actorId)
          .andWhere('filtered', true)
          .whereIn('sourceActorId', chunk)
          .delete()
      )
    )
  },

  async getNotificationsForGroupKey({
    actorId,
    groupKey,
    includeFiltered
  }: NotificationGroupKeyParams) {
    let query = applyGroupKeyMatch(
      database('notifications').where('actorId', actorId),
      groupKey
    )
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')

    if (!includeFiltered) {
      query = query.andWhere('filtered', false)
    }

    const results = await query
    return results.map(fixNotificationDataDate)
  },

  async dismissNotificationGroup({
    actorId,
    groupKey
  }: NotificationGroupKeyParams) {
    // Only dismiss visible (non-filtered) rows. Policy-filtered notifications can
    // share a groupKey with visible ones but live in the requests queue; deleting
    // them here would silently discard pending requests the user never saw.
    await applyGroupKeyMatch(
      database('notifications').where('actorId', actorId),
      groupKey
    )
      .andWhere('filtered', false)
      .delete()
  },

  async deleteNotification(notificationId: string) {
    await database('notifications').where('id', notificationId).delete()
  }
})

// Resolves the most recent filtered notification from a source actor and packs
// it with the group counts into a NotificationRequest.
const buildNotificationRequest = async (
  database: Knex,
  actorId: string,
  sourceActorId: string,
  notificationsCount: number,
  firstCreatedAt: number | Date | string,
  lastCreatedAt: number | Date | string
): Promise<NotificationRequest | null> => {
  const last = await database<Notification>('notifications')
    .where('actorId', actorId)
    .andWhere('filtered', true)
    .andWhere('sourceActorId', sourceActorId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .first()
  if (!last) return null

  return {
    sourceActorId,
    notificationsCount,
    lastNotification: fixNotificationDataDate(last),
    createdAt: getCompatibleTime(firstCreatedAt),
    updatedAt: getCompatibleTime(lastCreatedAt)
  }
}
