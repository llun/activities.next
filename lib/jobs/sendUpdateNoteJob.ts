import { z } from 'zod'

import { sendUpdateNote } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { loadStatusAndActor } from '@/lib/jobs/loadStatusAndActor'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { JobHandle } from '@/lib/services/queue/type'
import { StatusType } from '@/lib/types/domain/status'
import { withSpan } from '@/lib/utils/trace'

/**
 * Job data schema for sending note updates
 */
export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string()
})

/**
 * Job handler for sending note updates to federated actors
 *
 * This job fetches the status and actor, then sends update activities
 * to all relevant inboxes based on the note's to/cc fields
 */
export const sendUpdateNoteJob: JobHandle = createJobHandle(
  SEND_UPDATE_NOTE_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'sendUpdateNote', {}, async (span) => {
      const { actorId, statusId } = JobData.parse(message.data)
      const { status, actor } = await loadStatusAndActor(database, span, {
        actorId,
        statusId
      })

      if (!status || !actor) {
        span.recordException(new Error('Status or actor not found'))
        return
      }

      if (status.type !== StatusType.enum.Note) {
        span.recordException(new Error('Status is not a Note'))
        return
      }

      const uniqueInboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status,
        statusId: status.id
      })
      await Promise.all(
        uniqueInboxes.map(async (inbox) => {
          try {
            await sendUpdateNote({
              currentActor: actor,
              inbox,
              status
            })
          } catch (e) {
            // Delivery errors never change follow state; the follow stays and
            // later deliveries retry (Mastodon behaves the same way).
            span.recordException(e as Error)
            span.setAttribute('error.inbox', inbox)
          }
        })
      )
    })
  }
)
