import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { CreateStatus } from '@/lib/activities/createStatus'
import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { loadStatusAndActor } from '@/lib/jobs/loadStatusAndActor'
import { DELIVER_ACTIVITY_JOB_NAME, SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { getQueue } from '@/lib/services/queue'
import { JobHandle } from '@/lib/services/queue/type'
import { CreateAction } from '@/lib/types/activitypub/activities'
import { StatusType } from '@/lib/types/domain/status'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { withSpan } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string()
})

export const sendNoteJob: JobHandle = createJobHandle(
  SEND_NOTE_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'sendNote', {}, async (span) => {
      const { actorId, statusId } = JobData.parse(message.data)
      const { status, actor } = await loadStatusAndActor(database, span, {
        actorId,
        statusId
      })

      if (!status || !actor) {
        span.recordException(new Error('Status or actor not found'))
        return
      }

      const note = getNoteFromStatus(status)
      if (
        !note ||
        (status.type !== StatusType.enum.Note &&
          status.type !== StatusType.enum.Poll)
      ) {
        span.recordException(new Error('Failed to get note from status'))
        return
      }

      const federatedInboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status
      })

      const activity: CreateStatus = {
        '@context': NOTE_ACTIVITY_CONTEXT,
        id: note.id,
        type: CreateAction,
        actor: note.attributedTo,
        published: note.published,
        to: note.to,
        cc: note.cc,
        object: note
      }

      const queue = getQueue()
      await Promise.all(
        federatedInboxes.map((inbox) =>
          queue.publish({
            id: randomUUID(),
            name: DELIVER_ACTIVITY_JOB_NAME,
            data: {
              inbox,
              actorId: actor.id,
              activity: activity as unknown as Record<string, unknown>
            }
          })
        )
      )
    })
  }
)
