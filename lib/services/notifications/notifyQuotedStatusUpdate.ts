import { Database } from '@/lib/database/types'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { getOriginalStatus } from '@/lib/types/domain/status'

// How many accepted quote edges to enumerate per page. getQuotingStatusIds
// keyset-pages over (createdAt, statusId), so a status quoted more than this
// many times is covered by looping with the maxId cursor.
export const QUOTING_STATUS_PAGE_SIZE = 40

interface NotifyQuotedStatusUpdateParams {
  database: Database
  // The status that was edited (the quoted status).
  quotedStatusId: string
  // The actor who edited it (the quoted status's author) — the notification
  // source and the self-quote guard's excluded recipient.
  sourceActorId: string
  // Optional pre-resolved source actor, forwarded to sendNotificationAlerts so
  // it does not re-fetch (mirrors the createNote quote producer).
  sourceActor?: Actor
}

/**
 * Notify the authors of accepted quotes OF an edited status that a post they
 * quoted was updated. Mirrors the `quote` notification producer in createNote
 * but in the inverse direction: enumerate every `accepted` quote edge whose
 * `quotedStatusId` is the edited status and notify each LOCAL quoting author
 * (remote quoters learn of the edit via the federated Update, so they get no
 * stored notification). The editor's own quote of their status is skipped.
 *
 * Delivery is best-effort: the per-recipient `sendNotificationAlerts` call is
 * fire-and-forget (it handles its own errors) so alerting never fails the edit.
 */
export const notifyQuotedStatusUpdate = async ({
  database,
  quotedStatusId,
  sourceActorId,
  sourceActor
}: NotifyQuotedStatusUpdateParams): Promise<void> => {
  let maxId: string | undefined
  for (;;) {
    const quotingStatusIds = await database.getQuotingStatusIds({
      quotedStatusId,
      state: 'accepted',
      limit: QUOTING_STATUS_PAGE_SIZE,
      ...(maxId ? { maxId } : {})
    })
    if (quotingStatusIds.length === 0) break

    // Hydrate the page in one query rather than one lookup per quoter.
    const quotingStatuses = await database.getStatusesByIds({
      statusIds: quotingStatusIds,
      withReplies: false
    })

    for (const quotingStatus of quotingStatuses) {
      // Only local quoting authors get a stored notification.
      if (!quotingStatus.isLocalActor) continue

      const quotingActorId = getOriginalStatus(quotingStatus).actorId
      // Skip the editor's own quote of their status (self-quote guard, mirroring
      // createNote's quotedAuthorId !== currentActor.id).
      if (quotingActorId === sourceActorId) continue

      const notification = await createNotificationWithPolicy(database, {
        actorId: quotingActorId,
        type: NotificationType.enum.quoted_update,
        sourceActorId,
        // Attach the recipient's own quote post (matching how the `quote`
        // producer attaches the quoting status), so the notification renders it
        // and the conversation-mute check keys off it.
        statusId: quotingStatus.id,
        groupKey: `quoted_update:${quotedStatusId}`
      })
      if (notification && !notification.filtered) {
        sendNotificationAlerts({
          database,
          actorId: quotingActorId,
          sourceActorId,
          ...(sourceActor ? { sourceActor } : {}),
          statusId: quotingStatus.id,
          events: [
            {
              type: NotificationType.enum.quoted_update,
              notificationId: notification.id
            }
          ]
        })
      }
    }

    if (quotingStatusIds.length < QUOTING_STATUS_PAGE_SIZE) break
    maxId = quotingStatusIds[quotingStatusIds.length - 1]
  }
}
