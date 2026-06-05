import { Database } from '@/lib/database/types'
import { resolveConversationRootId } from '@/lib/services/mastodon/conversationMute'
import { evaluateNotificationPolicy } from '@/lib/services/notifications/evaluateNotificationPolicy'
import {
  CreateNotificationParams,
  Notification
} from '@/lib/types/database/operations'

/**
 * Creates a notification, applying the recipient's notification policy:
 * - drop   → nothing is persisted, returns null
 * - filter → persisted with filtered = true (lands in the requests queue)
 * - accept → persisted with filtered = false (shows in the main timeline)
 *
 * This is the single enforcement seam for all notification creation. Call this
 * instead of database.createNotification from application code.
 */
export const createNotificationWithPolicy = async (
  database: Database,
  params: CreateNotificationParams
): Promise<Notification | null> => {
  // Suppress notifications for conversations the recipient has muted. Only
  // status-bound notifications (mention, reply, favourite, reblog, poll, …)
  // belong to a conversation; account-level ones (e.g. follow) carry no
  // statusId and are never suppressed here. Check the recipient's (usually
  // empty) mute list first so the common case skips the thread-root walk.
  if (params.statusId) {
    const mutedRootIds = await database.getActorMutedConversationRootIds({
      actorId: params.actorId
    })
    if (mutedRootIds.length > 0) {
      const status = await database.getStatus({
        statusId: params.statusId,
        withReplies: false
      })
      if (status) {
        const conversationRootId = await resolveConversationRootId(
          database,
          status
        )
        if (mutedRootIds.includes(conversationRootId)) return null
      }
    }
  }

  const verdict = await evaluateNotificationPolicy(database, {
    actorId: params.actorId,
    type: params.type,
    sourceActorId: params.sourceActorId,
    statusId: params.statusId
  })

  if (verdict === 'drop') return null

  return database.createNotification({
    ...params,
    filtered: verdict === 'filter'
  })
}
