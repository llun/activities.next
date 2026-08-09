import { Database } from '@/lib/database/types'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Mastodon } from '@/lib/types/activitypub'
import { NotificationRequest } from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

// Mastodon NotificationRequest entity. `notifications_count` is serialized as a
// string by Mastodon; `id` and `account.id` are the source actor's account id.
export interface MastodonNotificationRequest {
  id: string
  created_at: string
  updated_at: string
  notifications_count: string
  account: Mastodon.Account
  last_status?: Mastodon.Status
}

export const getMastodonNotificationRequest = async (
  database: Database,
  request: NotificationRequest,
  currentActorId?: string
): Promise<MastodonNotificationRequest | null> => {
  const account = await database.getMastodonActorFromId({
    id: request.sourceActorId
  })
  if (!account) return null

  let lastStatus: Mastodon.Status | undefined
  if (request.lastNotification.statusId) {
    const statusData = await database.getStatus({
      statusId: request.lastNotification.statusId,
      withReplies: false
    })
    if (statusData) {
      lastStatus =
        (await getMastodonStatus(database, statusData, currentActorId)) ??
        undefined
    }
  }

  return {
    // The request id IS the source actor's account id, so it is taken straight
    // off the already-serialized account entity — that keeps the two identical
    // by construction rather than by re-deriving the same encoding twice.
    id: account.id,
    created_at: getISOTimeUTC(request.createdAt),
    updated_at: getISOTimeUTC(request.updatedAt),
    notifications_count: request.notificationsCount.toString(),
    account,
    last_status: lastStatus
  }
}
