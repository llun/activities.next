import { Database } from '@/lib/database/types'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import {
  MastodonNotificationGroup,
  getNotificationGroup
} from '@/lib/services/notifications/getNotificationGroup'
import {
  GroupedNotification,
  groupNotifications
} from '@/lib/services/notifications/groupNotifications'
import { Mastodon } from '@/lib/types/activitypub'
import { Notification } from '@/lib/types/database/operations'

// Mastodon's dehydrated grouped-notifications response: groups reference shared
// accounts and statuses by id, deduped into top-level arrays.
export interface NotificationGroupsEnvelope {
  notification_groups: MastodonNotificationGroup[]
  accounts: Mastodon.Account[]
  statuses: Mastodon.Status[]
}

const resolveAccounts = async (
  database: Database,
  actorIds: string[]
): Promise<Mastodon.Account[]> => {
  if (actorIds.length === 0) return []
  return database.getMastodonActorsFromIds({ ids: actorIds })
}

const resolveStatuses = async (
  database: Database,
  statusIds: string[],
  currentActorId?: string
): Promise<Mastodon.Status[]> => {
  const statuses = await Promise.all(
    statusIds.map(async (statusId) => {
      const status = await database.getStatus({ statusId, withReplies: false })
      if (!status) return null
      return getMastodonStatus(database, status, currentActorId)
    })
  )
  return statuses.filter((status): status is Mastodon.Status => status !== null)
}

/**
 * Builds the Mastodon grouped-notifications envelope from already-grouped
 * notifications: one NotificationGroup per group, plus the deduped accounts and
 * statuses they reference.
 */
export const getNotificationGroupsEnvelope = async (
  database: Database,
  grouped: GroupedNotification[],
  currentActorId?: string
): Promise<NotificationGroupsEnvelope> => {
  const results = grouped.map(getNotificationGroup)

  const actorIds = Array.from(
    new Set(results.flatMap((result) => result.sampleActorIds))
  )
  const statusIds = Array.from(
    new Set(
      results
        .map((result) => result.statusId)
        .filter((statusId): statusId is string => Boolean(statusId))
    )
  )

  const [accounts, statuses] = await Promise.all([
    resolveAccounts(database, actorIds),
    resolveStatuses(database, statusIds, currentActorId)
  ])

  return {
    notification_groups: results.map((result) => result.group),
    accounts,
    statuses
  }
}

// Convenience: group raw notifications then build the envelope.
export const buildNotificationGroupsEnvelope = (
  database: Database,
  notifications: Notification[],
  currentActorId?: string
): Promise<NotificationGroupsEnvelope> =>
  getNotificationGroupsEnvelope(
    database,
    groupNotifications(notifications, true),
    currentActorId
  )
