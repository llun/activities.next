import { Database } from '@/lib/database/types'
import { applyFiltersToStatus } from '@/lib/services/filters/applyFilters'
import { FilterRecordWithStatusPublicIds } from '@/lib/services/mastodon/getMastodonFilter'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { DEFAULT_GROUPABLE_TYPES } from '@/lib/services/notifications/notificationTypeMapping'
import { Mastodon } from '@/lib/types/activitypub'
import { Notification, NotificationType } from '@/lib/types/database/operations'
import { Status } from '@/lib/types/domain/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

// Mastodon notification type mapping
type MastodonNotificationType =
  | 'mention'
  | 'status'
  | 'reblog'
  | 'quote'
  | 'quoted_update'
  | 'follow'
  | 'follow_request'
  | 'favourite'
  | 'poll'
  | 'update'
  | 'added_to_collection'
  | 'collection_update'
  | 'admin.sign_up'
  | 'admin.report'
  // Ecosystem dialect (Pleroma/Akkoma), not core Mastodon.
  | 'pleroma:emoji_reaction'

export interface MastodonNotification {
  id: string
  type: MastodonNotificationType
  created_at: string
  // The stable grouping key. For already-grouped input it is the key the
  // grouping step computed. For raw (ungrouped) rows it is the stored groupKey
  // only when the type is groupable by default (like/reblog/follow), otherwise
  // `ungrouped-<id>` — so mentions/replies/collections, whose stored groupKey
  // is an internal key, report the same `ungrouped-<id>` the v2 grouped API does.
  group_key: string
  account: Mastodon.Account
  status?: Mastodon.Status
  // Pleroma dialect: the emoji of a `pleroma:emoji_reaction` notification.
  // Absent for every other type.
  emoji?: string
  // Non-standard fields for grouping support (backward compatibility)
  grouped_count?: number
  grouped_accounts?: Mastodon.Account[]
}

export interface GetMastodonNotificationOptions {
  includeGrouping?: boolean
  currentActorId?: string
  filterRecords?: FilterRecordWithStatusPublicIds[]
}

// A notification's status: the serialized entity plus the domain row the
// filters are applied to.
interface ResolvedNotificationStatus {
  domainStatus: Status
  mastodonStatus: Mastodon.Status
}

/**
 * Hydrates every status a page of notifications references in one fetch and one
 * batched serialization.
 *
 * getMastodonStatuses resolves the whole page's mention publicIds — plus its
 * reblog/reply counts, reaction rollups, pinned state and quoted statuses — in
 * one query each. A notification-at-a-time call issues one of each per status,
 * and the mention lookup in particular is a query that did not exist before ids
 * became publicIds.
 */
const resolveNotificationStatuses = async (
  database: Database,
  notifications: (Notification | GroupedNotification)[],
  currentActorId?: string
): Promise<Map<string, ResolvedNotificationStatus>> => {
  const resolved = new Map<string, ResolvedNotificationStatus>()
  const statusIds = [
    ...new Set(
      notifications
        .map((notification) => notification.statusId)
        .filter((statusId): statusId is string => Boolean(statusId))
    )
  ]
  if (statusIds.length === 0) return resolved

  // Deliberately fetched without a viewer, exactly as the per-notification path
  // did: the v1 notification entity has never carried the viewer's own action
  // state on its status.
  const domainStatuses = await database.getStatusesByIds({
    statusIds,
    withReplies: false
  })
  const mastodonStatuses = await getMastodonStatuses(
    database,
    domainStatuses,
    currentActorId
  )
  // Join on the ActivityPub URI: a serialized status's `id` is a publicId,
  // while the notification and the domain row both carry the stored URI.
  const mastodonStatusByUri = new Map(
    mastodonStatuses.map((status) => [status.uri, status] as const)
  )
  for (const domainStatus of domainStatuses) {
    const mastodonStatus = mastodonStatusByUri.get(domainStatus.id)
    if (!mastodonStatus) continue
    resolved.set(domainStatus.id, { domainStatus, mastodonStatus })
  }
  return resolved
}

/**
 * Map internal notification type to Mastodon API type
 */
const mapNotificationType = (
  type: NotificationType
): MastodonNotificationType => {
  switch (type) {
    case 'like':
      return 'favourite'
    case 'reply':
      return 'mention'
    case 'reblog':
      return 'reblog'
    case 'quote':
      return 'quote'
    case 'quoted_update':
      return 'quoted_update'
    case 'follow':
      return 'follow'
    case 'follow_request':
      return 'follow_request'
    case 'mention':
      return 'mention'
    case 'activity_import':
      return 'status'
    case 'added_to_collection':
      return 'added_to_collection'
    case 'collection_update':
      return 'collection_update'
    case 'emoji_reaction':
      return 'pleroma:emoji_reaction'
    default:
      return 'mention' // Default fallback
  }
}

/**
 * Transform internal notification to Mastodon-compatible format
 */
const serializeNotification = async (
  database: Database,
  notification: Notification | GroupedNotification,
  resolvedStatuses: ReadonlyMap<string, ResolvedNotificationStatus>,
  options?: GetMastodonNotificationOptions
): Promise<MastodonNotification | null> => {
  const { includeGrouping = false, filterRecords } = options || {}

  // Fetch account
  const account = await database.getMastodonActorFromId({
    id: notification.sourceActorId
  })

  if (!account) {
    return null
  }

  // Attach the status if present, from the page-wide hydration above
  let status: Mastodon.Status | undefined
  const resolvedStatus = notification.statusId
    ? resolvedStatuses.get(notification.statusId)
    : undefined
  if (resolvedStatus) {
    const { domainStatus, mastodonStatus } = resolvedStatus
    if (filterRecords && filterRecords.length > 0) {
      const matches = applyFiltersToStatus(domainStatus, filterRecords)
      if (matches.some((match) => match.filter.filter_action === 'hide')) {
        return null
      }
      if (matches.length > 0) {
        if (mastodonStatus.reblog) {
          status = {
            ...mastodonStatus,
            reblog: { ...mastodonStatus.reblog, filtered: matches }
          }
        } else {
          status = { ...mastodonStatus, filtered: matches }
        }
      } else {
        status = mastodonStatus
      }
    } else {
      status = mastodonStatus
    }
  }

  // Already-grouped input carries the key the grouping step computed (which
  // already honors the requested grouped_types). Raw rows only surface their
  // stored groupKey for default-groupable types; a non-groupable type's stored
  // key is internal, so it reports `ungrouped-<id>` to match the v2 API.
  const groupKey =
    includeGrouping || DEFAULT_GROUPABLE_TYPES.has(notification.type)
      ? (notification.groupKey ?? `ungrouped-${notification.id}`)
      : `ungrouped-${notification.id}`

  // Base notification
  const mastodonNotification: MastodonNotification = {
    id: notification.id,
    type: mapNotificationType(notification.type),
    created_at: getISOTimeUTC(notification.createdAt),
    group_key: groupKey,
    account,
    status,
    ...(notification.type === NotificationType.enum.emoji_reaction &&
    notification.reactionName
      ? { emoji: notification.reactionName }
      : {})
  }

  // Include grouping fields if enabled and notification is grouped
  if (
    includeGrouping &&
    'groupedActors' in notification &&
    notification.groupedActors
  ) {
    mastodonNotification.grouped_count = notification.groupedCount || 1

    // Fetch grouped accounts (up to 3)
    if (notification.groupedActors.length > 1) {
      const groupedAccounts = await Promise.all(
        notification.groupedActors
          .slice(0, 3)
          .map((actorId) => database.getMastodonActorFromId({ id: actorId }))
      )
      mastodonNotification.grouped_accounts = groupedAccounts.filter(
        (acc: Mastodon.Account | null): acc is Mastodon.Account => acc !== null
      )
    }
  }

  return mastodonNotification
}

/**
 * Serializes a page of notifications, hydrating every status they reference
 * once. Prefer this over mapping getMastodonNotification across a page — that
 * repeats the whole per-status lookup set for each notification.
 */
export const getMastodonNotifications = async (
  database: Database,
  notifications: (Notification | GroupedNotification)[],
  options?: GetMastodonNotificationOptions
): Promise<MastodonNotification[]> => {
  const resolvedStatuses = await resolveNotificationStatuses(
    database,
    notifications,
    options?.currentActorId
  )
  const serialized = await Promise.all(
    notifications.map((notification) =>
      serializeNotification(database, notification, resolvedStatuses, options)
    )
  )
  return serialized.filter(
    (notification): notification is MastodonNotification =>
      notification !== null
  )
}

export const getMastodonNotification = async (
  database: Database,
  notification: Notification | GroupedNotification,
  options?: GetMastodonNotificationOptions
): Promise<MastodonNotification | null> =>
  (await getMastodonNotifications(database, [notification], options))[0] ?? null
