import { z } from 'zod'

import { buildUpdateNoteActivity } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { loadStatusAndActor } from '@/lib/jobs/loadStatusAndActor'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { enqueueDeliveries } from '@/lib/services/federation/enqueueDeliveries'
import { getStatusCommunityActorId } from '@/lib/services/federation/replyCommunity'
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
 * This job fetches the status and actor, builds one Update activity, and
 * enqueues deliveries to all relevant inboxes based on the note's to/cc fields.
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

      if (
        status.type !== StatusType.enum.Note &&
        status.type !== StatusType.enum.Poll
      ) {
        span.recordException(new Error('Status is not a Note or Poll'))
        return
      }

      const audience = await getStatusCommunityActorId({ database, status })
      const activity = buildUpdateNoteActivity({ status, audience })
      if (!activity) {
        span.recordException(
          new Error('Failed to build update activity from status')
        )
        return
      }

      const uniqueInboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status,
        statusId: status.id
      })

      await enqueueDeliveries({
        database,
        parentMessageId: message.id,
        actorId: actor.id,
        activity: activity as unknown as Record<string, unknown>,
        inboxes: uniqueInboxes,
        span,
        statusId: status.id
      })
    })
  }
)
