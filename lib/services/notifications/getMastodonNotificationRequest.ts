import { Database } from '@/lib/database/types'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Mastodon } from '@/lib/types/activitypub'
import { NotificationRequest } from '@/lib/types/database/operations'
import { urlToId } from '@/lib/utils/urlToId'

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
    id: urlToId(request.sourceActorId),
    created_at: new Date(request.createdAt).toISOString(),
    updated_at: new Date(request.updatedAt).toISOString(),
    notifications_count: request.notificationsCount.toString(),
    account,
    last_status: lastStatus
  }
}
