import { z } from 'zod'

import { undoAnnounce } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { filterFederatedUrls } from '@/lib/services/federation/domainPolicy'
import { JobHandle } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'
import { withSpan } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string(),
  // The Announce's own data, captured by the action BEFORE it deleted the row.
  // database.deleteStatus is a hard delete, so loading the status here finds
  // nothing — which is exactly what this job used to do, silently skipping
  // federation and leaving every remote server showing a boost the author had
  // already removed.
  originalStatusId: z.string(),
  to: z.string().array(),
  cc: z.string().array(),
  createdAt: z.number()
})

export const sendUndoAnnounceJob: JobHandle = createJobHandle(
  SEND_UNDO_ANNOUNCE_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'sendUndoAnnounce', {}, async (span) => {
      const { actorId, statusId, originalStatusId, to, cc, createdAt } =
        JobData.parse(message.data)
      span.setAttribute('actorId', actorId)
      span.setAttribute('statusId', statusId)

      // The actor is still read from the database: actors outlive their
      // statuses and the Undo has to be signed. The action's ownership guard
      // means this actor is also the Announce's author.
      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        span.recordException(new Error('Actor not found'))
        logger.error(
          { actorId, statusId },
          'Cannot federate undo announce: actor not found'
        )
        return
      }

      // Same follower fan-out the boost itself used (sendAnnounceJob), so an
      // unboost reaches everyone the Announce did.
      const inboxes = await database.getFollowersInbox({
        targetActorId: actorId
      })
      const federatedInboxes = await filterFederatedUrls(database, inboxes)
      await Promise.all(
        federatedInboxes.map((inbox) =>
          undoAnnounce({
            currentActor: actor,
            inbox,
            announce: {
              id: statusId,
              actorId,
              createdAt,
              to,
              cc,
              originalStatus: { id: originalStatusId }
            }
          })
        )
      )
    })
  }
)
