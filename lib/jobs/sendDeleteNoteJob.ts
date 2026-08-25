import { z } from 'zod'

import { deleteStatus } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_DELETE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { JobHandle } from '@/lib/services/queue/type'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string(),
  // The status's audience, captured by the action BEFORE the local delete.
  // database.deleteStatus is a cascading hard delete, so by the time this job
  // runs the row is gone: delivery targets and the direct-visibility to/cc
  // preservation below must come from the payload. Loading the status here
  // (loadStatusAndActor) would find nothing and silently skip federation.
  to: z.string().array(),
  cc: z.string().array()
})

// Fans a status Delete (Tombstone) out to the audience the status had when its
// author deleted it. The actor is still loaded from the database because the
// Delete has to be signed, and actors outlive their statuses.
export const sendDeleteNoteJob: JobHandle = createJobHandle(
  SEND_DELETE_NOTE_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'sendDeleteNote', {}, async (span) => {
      const { actorId, statusId, to, cc } = JobData.parse(message.data)
      span.setAttribute('actorId', actorId)
      span.setAttribute('statusId', statusId)

      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        // Terminal, not retryable: without the actor there is no key to sign
        // with. Logged because the status row is already gone, so this is the
        // only remaining record that a Delete was owed.
        span.recordException(new Error('Actor not found'))
        logger.error(
          { actorId, statusId },
          'Cannot federate status delete: actor not found'
        )
        return
      }

      const inboxes = await getFederatedStatusDeliveryInboxes({
        database,
        currentActor: actor,
        status: { to, cc }
      })

      // Direct statuses keep their original recipients so the Delete reaches
      // exactly who saw the status; everything else defaults to Public.
      const isDirect = getVisibility(to, cc) === 'direct'
      await Promise.all(
        inboxes.map(async (inbox) => {
          try {
            await deleteStatus({
              currentActor: actor,
              inbox,
              statusId,
              to: isDirect ? to : undefined,
              cc: isDirect ? cc : undefined
            })
          } catch (error) {
            logger.error(
              { inbox, statusId, err: toLoggableError(error) },
              'Failed to send delete status'
            )
          }
        })
      )
    })
  }
)
