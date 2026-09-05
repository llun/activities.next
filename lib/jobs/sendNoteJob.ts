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

      span.addEvent('fanout_started', {
        'fanout.inbox_count': federatedInboxes.length,
        'fanout.actor_id': actor.id,
        'fanout.status_id': status.id,
        'queue.runs_inline': queue.runsInline
      })

      if (queue.runsInline) {
        const results = await Promise.allSettled(
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

        let failureCount = 0
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          if (result.status === 'rejected') {
            failureCount++
            const err =
              result.reason instanceof Error
                ? result.reason
                : new Error(String(result.reason))
            span.addEvent('inbox_delivery_inline_error', {
              'delivery.inbox': federatedInboxes[i],
              'error.message': err.message
            })
          }
        }

        span.addEvent('fanout_completed', {
          'fanout.inbox_count': federatedInboxes.length,
          'fanout.failure_count': failureCount,
          'queue.runs_inline': true
        })
      } else {
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

        span.addEvent('fanout_completed', {
          'fanout.inbox_count': federatedInboxes.length,
          'fanout.failure_count': 0,
          'queue.runs_inline': false
        })
      }
    })
  }
)
