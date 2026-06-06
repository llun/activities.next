import { z } from 'zod'

import { undoAnnounce } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { loadStatusAndActor } from '@/lib/jobs/loadStatusAndActor'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { filterFederatedUrls } from '@/lib/services/federation/domainPolicy'
import { JobHandle } from '@/lib/services/queue/type'
import { StatusType } from '@/lib/types/domain/status'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string()
})

export const sendUndoAnnounceJob: JobHandle = createJobHandle(
  SEND_UNDO_ANNOUNCE_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendUndoAnnounceJob', async (span) => {
      const { actorId, statusId } = JobData.parse(message.data)
      const { status, actor } = await loadStatusAndActor(database, span, {
        actorId,
        statusId
      })
      if (!status || !actor || status.type !== StatusType.enum.Announce) {
        span.recordException(
          new Error('Status or actor not found or status is not an announce')
        )
        span.end()
        return
      }

      const inboxes = await database.getFollowersInbox({
        targetActorId: actorId
      })
      const federatedInboxes = await filterFederatedUrls(database, inboxes)
      await Promise.all(
        federatedInboxes.map((inbox) =>
          undoAnnounce({ currentActor: actor, inbox, announce: status })
        )
      )
      span.end()
    })
  }
)
