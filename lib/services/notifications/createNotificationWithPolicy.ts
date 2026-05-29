import { Database } from '@/lib/database/types'
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
