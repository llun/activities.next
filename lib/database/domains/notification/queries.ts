import { type ExpressionBuilder, type Selectable } from 'kysely'

import type {
  CreateNotificationParams,
  GetNotificationRequestParams,
  GetNotificationRequestsParams,
  GetNotificationsCountParams,
  GetNotificationsParams,
  MarkNotificationsReadParams,
  Notification,
  NotificationGroupKeyParams,
  NotificationRequest,
  NotificationType,
  ResolveNotificationRequestsParams
} from '@/lib/database/domains/notification/types'
import type { DB, Db } from '@/lib/database/kysely'
import type { Notifications } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import { generatePublicId } from '@/lib/utils/publicId'

const NOTIFICATION_GROUP_MAX_ROWS = 1000
// Mastodon caps pending_requests_count at 100 in the policy summary.
const MAX_REQUESTS_COUNT = 100

const toNotification = (row: Selectable<Notifications>): Notification => ({
  id: row.id,
  actorId: row.actorId,
  type: row.type as NotificationType,
  sourceActorId: row.sourceActorId,
  // An unset statusId, followId or groupKey reads back as null, though the type
  // says undefined; callers have always received the null.
  statusId: row.statusId as string | undefined,
  followId: row.followId as string | undefined,
  groupKey: row.groupKey as string | undefined,
  isRead: Boolean(row.isRead),
  filtered: row.filtered,
  // Nullable only for `emoji_reaction` rows, which carry a name.
  reactionName: row.reactionName ?? undefined,
  readAt: row.readAt ? row.readAt : undefined,
  // Nullable in the schema, but every writer sets both.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

// Match a group by its shared groupKey (e.g. 'like:<status>' or 'follow:<day>')
// or, for ungrouped notifications, by the notification id itself.
const matchesGroupKey = (
  eb: ExpressionBuilder<DB, 'notifications'>,
  groupKey: string
) => eb.or([eb('groupKey', '=', groupKey), eb('id', '=', groupKey)])

// The cursor row, scoped to the actor so a cursor can't read another actor's
// notification.
const findCursorNotification = (db: Db, actorId: string, id: string) =>
  db
    .selectFrom('notifications')
    .select(['id', 'createdAt'])
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()

export const createNotification = async (
  db: Db,
  {
    actorId,
    type,
    sourceActorId,
    statusId,
    followId,
    groupKey,
    reactionName,
    filtered = false
  }: CreateNotificationParams
): Promise<Notification> => {
  const currentTime = new Date()
  const notification: Notification = {
    // Mastodon notification ids are time-ordered snowflakes, and clients
    // (Ivory, for one) sort the notification list and compare the
    // notifications read marker by id. A UUIDv7 minted from createdAt sorts
    // the same way as a string, so the id order always matches the
    // (createdAt, id) order getNotifications pages by.
    id: generatePublicId(currentTime.getTime()),
    actorId,
    type,
    sourceActorId,
    statusId,
    followId,
    groupKey,
    reactionName,
    isRead: false,
    filtered,
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }

  await db
    .insertInto('notifications')
    .values({
      id: notification.id,
      actorId,
      type,
      sourceActorId,
      statusId: statusId ?? null,
      followId: followId ?? null,
      groupKey: groupKey ?? null,
      reactionName: reactionName ?? null,
      isRead: false,
      filtered,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()

  return notification
}

export const getNotifications = async (
  db: Db,
  {
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
  }: GetNotificationsParams
): Promise<Notification[]> => {
  let query = db
    .selectFrom('notifications')
    .selectAll()
    .where('actorId', '=', actorId)
    .limit(limit)

  // By default hide policy-filtered notifications (they live in the requests
  // queue). Mastodon's `include_filtered` opts back into seeing them.
  if (!includeFiltered) {
    query = query.where('filtered', '=', false)
  }

  if (sourceActorId) {
    query = query.where('sourceActorId', '=', sourceActorId)
  }

  // Cursor-based pagination on the composite (createdAt, id) cursor, which
  // handles same-timestamp notifications. Cursor lookups are scoped to actorId
  // to prevent information leaks.
  if (maxNotificationId) {
    const maxNotification = await findCursorNotification(
      db,
      actorId,
      maxNotificationId
    )
    if (maxNotification) {
      // Notifications older than the cursor.
      query = query.where((eb) =>
        pastKeyset(
          eb,
          {
            createdAt: maxNotification.createdAt ?? 0,
            tieBreaker: maxNotification.id
          },
          '<',
          'id'
        )
      )
    }
  }

  if (minNotificationId || sinceNotificationId) {
    const minId = minNotificationId || sinceNotificationId
    const minNotification = await findCursorNotification(
      db,
      actorId,
      minId as string
    )
    // An unresolvable lower-bound cursor (dismissed/cleared/foreign id)
    // terminates pagination with an empty page — matching getListTimeline —
    // rather than dropping the filter and returning the wrong end of the
    // timeline (which, with the ascending min_id order below, would surface
    // the OLDEST notifications instead of an adjacent/empty page).
    if (!minNotification) return []
    // Notifications newer than the cursor.
    query = query.where((eb) =>
      pastKeyset(
        eb,
        {
          createdAt: minNotification.createdAt ?? 0,
          tieBreaker: minNotification.id
        },
        '>',
        'id'
      )
    )
  }

  // Support offset-based pagination for backward compatibility
  if (!maxNotificationId && !minNotificationId && !sinceNotificationId) {
    query = query.offset(offset)
  }

  if (types && types.length > 0) {
    query = query.where('type', 'in', types)
  }

  if (excludeTypes && excludeTypes.length > 0) {
    query = query.where('type', 'not in', excludeTypes)
  }

  if (onlyUnread) {
    query = query.where('isRead', '=', false)
  }

  if (ids && ids.length > 0) {
    query = query.where('id', 'in', ids)
  }

  // min_id ascends from the cursor — the OLDEST notifications just newer than
  // it — then reverses to the newest-first response shape, so it returns the
  // page adjacent to the cursor. since_id (and max_id / no cursor) keep the
  // newest-first DESC ordering (the newest slice above the cursor).
  const ascending = Boolean(minNotificationId)
  const direction = ascending ? 'asc' : 'desc'
  const results = await query
    .orderBy('createdAt', direction)
    .orderBy('id', direction)
    .execute()
  return (ascending ? results.reverse() : results).map(toNotification)
}

export const getNotificationsCount = async (
  db: Db,
  {
    actorId,
    onlyUnread,
    types,
    excludeTypes,
    limit,
    includeFiltered,
    filteredOnly
  }: GetNotificationsCountParams
): Promise<number> => {
  let query = db.selectFrom('notifications').where('actorId', '=', actorId)

  if (filteredOnly) {
    query = query.where('filtered', '=', true)
  } else if (!includeFiltered) {
    query = query.where('filtered', '=', false)
  }

  if (onlyUnread) {
    query = query.where('isRead', '=', false)
  }

  if (types && types.length > 0) {
    query = query.where('type', 'in', types)
  }

  if (excludeTypes && excludeTypes.length > 0) {
    query = query.where('type', 'not in', excludeTypes)
  }

  // Mastodon caps unread_count at a limit; emulate by counting rows from a
  // bounded subquery rather than the whole table.
  if (limit !== undefined) {
    // ORDER BY is intentionally omitted: for a COUNT the sort order does not
    // affect the result, and skipping it lets the query planner avoid a
    // potentially expensive sort before the LIMIT.
    const capped = query.select('id').limit(limit).as('capped')
    const result = await db
      .selectFrom(capped)
      .select((eb) => eb.fn.countAll().as('count'))
      .executeTakeFirst()
    return Number(result?.count ?? 0)
  }

  const result = await query
    .select((eb) => eb.fn.countAll().as('count'))
    .executeTakeFirst()
  return Number(result?.count ?? 0)
}

export const markNotificationsRead = async (
  db: Db,
  { notificationIds }: MarkNotificationsReadParams
): Promise<void> => {
  if (notificationIds.length === 0) return

  const currentTime = new Date()
  await db
    .updateTable('notifications')
    .set({ isRead: true, readAt: currentTime, updatedAt: currentTime })
    .where('id', 'in', notificationIds)
    .execute()
}

// Resolves the most recent filtered notification from a source actor and packs
// it with the group counts into a NotificationRequest. min()/max() have no
// declared column type on SQLite, so the group times come back as stored.
const buildNotificationRequest = async (
  db: Db,
  actorId: string,
  sourceActorId: string,
  notificationsCount: number,
  firstCreatedAt: unknown,
  lastCreatedAt: unknown
): Promise<NotificationRequest | null> => {
  const last = await db
    .selectFrom('notifications')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('filtered', '=', true)
    .where('sourceActorId', '=', sourceActorId)
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  if (!last) return null

  return {
    sourceActorId,
    notificationsCount,
    lastNotification: toNotification(last),
    createdAt: toEpochMilliseconds(firstCreatedAt) ?? 0,
    updatedAt: toEpochMilliseconds(lastCreatedAt) ?? 0
  }
}

// The recipient's filtered rows grouped per source: how many, first and last.
const requestGroups = (db: Db, actorId: string) =>
  db
    .selectFrom('notifications')
    .where('actorId', '=', actorId)
    .where('filtered', '=', true)
    .groupBy('sourceActorId')
    .select('sourceActorId')
    .select((eb) => [
      eb.fn.countAll().as('count'),
      eb.fn.min('createdAt').as('firstCreatedAt'),
      eb.fn.max('createdAt').as('lastCreatedAt')
    ])

export const getNotificationRequests = async (
  db: Db,
  {
    actorId,
    limit,
    offset = 0,
    maxCursor,
    sinceCursor
  }: GetNotificationRequestsParams
): Promise<NotificationRequest[]> => {
  let query = requestGroups(db, actorId)
    .orderBy('lastCreatedAt', 'desc')
    .orderBy('sourceActorId', 'asc')
    .limit(limit)

  if (maxCursor !== undefined) {
    // Groups older than cursor: (MAX(createdAt) < cursor) OR
    // (MAX(createdAt) = cursor AND sourceActorId > cursor.sourceActorId)
    const cursorTime = timestampValue(maxCursor.updatedAt)
    query = query.having((eb) =>
      eb.or([
        eb(eb.fn.max('createdAt'), '<', cursorTime),
        eb.and([
          eb(eb.fn.max('createdAt'), '=', cursorTime),
          eb('sourceActorId', '>', maxCursor.sourceActorId)
        ])
      ])
    )
  } else if (sinceCursor !== undefined) {
    // Groups newer than cursor: (MAX(createdAt) > cursor) OR
    // (MAX(createdAt) = cursor AND sourceActorId < cursor.sourceActorId)
    const cursorTime = timestampValue(sinceCursor.updatedAt)
    query = query.having((eb) =>
      eb.or([
        eb(eb.fn.max('createdAt'), '>', cursorTime),
        eb.and([
          eb(eb.fn.max('createdAt'), '=', cursorTime),
          eb('sourceActorId', '<', sinceCursor.sourceActorId)
        ])
      ])
    )
  } else {
    query = query.offset(offset)
  }

  const groups = await query.execute()

  const requests = await Promise.all(
    groups.map((group) =>
      buildNotificationRequest(
        db,
        actorId,
        group.sourceActorId,
        Number(group.count),
        group.firstCreatedAt,
        group.lastCreatedAt
      )
    )
  )
  return requests.filter((request) => request !== null)
}

export const getNotificationRequest = async (
  db: Db,
  { actorId, sourceActorId }: GetNotificationRequestParams
): Promise<NotificationRequest | null> => {
  const group = await requestGroups(db, actorId)
    .where('sourceActorId', '=', sourceActorId)
    .executeTakeFirst()
  if (!group) return null

  return buildNotificationRequest(
    db,
    actorId,
    sourceActorId,
    Number(group.count),
    group.firstCreatedAt,
    group.lastCreatedAt
  )
}

export const getNotificationRequestsCount = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<number> => {
  const result = await db
    .selectFrom('notifications')
    .select((eb) => eb.fn.count('sourceActorId').distinct().as('count'))
    .where('actorId', '=', actorId)
    .where('filtered', '=', true)
    .executeTakeFirst()
  return Math.min(Number(result?.count ?? 0), MAX_REQUESTS_COUNT)
}

export const acceptNotificationRequests = async (
  db: Db,
  { actorId, sourceActorIds }: ResolveNotificationRequestsParams
): Promise<void> => {
  if (sourceActorIds.length === 0) return
  await Promise.all(
    chunkArray(sourceActorIds, getWhereInBatchSize(db)).map((chunk) =>
      db
        .updateTable('notifications')
        .set({ filtered: false, updatedAt: new Date() })
        .where('actorId', '=', actorId)
        .where('filtered', '=', true)
        .where('sourceActorId', 'in', chunk)
        .execute()
    )
  )
}

export const dismissNotificationRequests = async (
  db: Db,
  { actorId, sourceActorIds }: ResolveNotificationRequestsParams
): Promise<void> => {
  if (sourceActorIds.length === 0) return
  await Promise.all(
    chunkArray(sourceActorIds, getWhereInBatchSize(db)).map((chunk) =>
      db
        .deleteFrom('notifications')
        .where('actorId', '=', actorId)
        .where('filtered', '=', true)
        .where('sourceActorId', 'in', chunk)
        .execute()
    )
  )
}

export const getNotificationsForGroupKey = async (
  db: Db,
  { actorId, groupKey, includeFiltered, limit }: NotificationGroupKeyParams
): Promise<Notification[]> => {
  let query = db
    .selectFrom('notifications')
    .selectAll()
    .where('actorId', '=', actorId)
    .where((eb) => matchesGroupKey(eb, groupKey))
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    // A group (every follow in a day bucket, every like on one status) is
    // unbounded and these rows are all loaded into memory by the grouped
    // notification endpoints, so the newest NOTIFICATION_GROUP_MAX_ROWS is
    // all a caller can get, whatever it asks for.
    .limit(
      Math.min(
        Math.max(limit ?? NOTIFICATION_GROUP_MAX_ROWS, 1),
        NOTIFICATION_GROUP_MAX_ROWS
      )
    )

  if (!includeFiltered) {
    query = query.where('filtered', '=', false)
  }

  const results = await query.execute()
  return results.map(toNotification)
}

export const dismissNotificationGroup = async (
  db: Db,
  { actorId, groupKey }: NotificationGroupKeyParams
): Promise<void> => {
  // Only dismiss visible (non-filtered) rows. Policy-filtered notifications can
  // share a groupKey with visible ones but live in the requests queue; deleting
  // them here would silently discard pending requests the user never saw.
  await db
    .deleteFrom('notifications')
    .where('actorId', '=', actorId)
    .where((eb) => matchesGroupKey(eb, groupKey))
    .where('filtered', '=', false)
    .execute()
}

export const deleteNotification = async (
  db: Db,
  notificationId: string
): Promise<void> => {
  await db
    .deleteFrom('notifications')
    .where('id', '=', notificationId)
    .execute()
}

// The facade getSQLDatabase binds with bindDb().
export const notificationQueries = {
  createNotification,
  getNotifications,
  getNotificationsCount,
  markNotificationsRead,
  getNotificationRequests,
  getNotificationRequest,
  getNotificationRequestsCount,
  acceptNotificationRequests,
  dismissNotificationRequests,
  getNotificationsForGroupKey,
  dismissNotificationGroup,
  deleteNotification
}
