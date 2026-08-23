import { z } from 'zod'

import { sendAnnounce } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { loadStatusAndActor } from '@/lib/jobs/loadStatusAndActor'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { filterFederatedUrls } from '@/lib/services/federation/domainPolicy'
import { JobHandle } from '@/lib/services/queue/type'
import { withSpan } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string()
})

export const sendAnnounceJob: JobHandle = createJobHandle(
  SEND_ANNOUNCE_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'sendAnnounce', {}, async (span) => {
      const { actorId, statusId } = JobData.parse(message.data)
      const { status, actor } = await loadStatusAndActor(database, span, {
        actorId,
        statusId
      })
      if (!status || !actor) {
        span.recordException(new Error('Status or actor not found'))
        return
      }

      const inboxes = await database.getFollowersInbox({
        targetActorId: actorId
      })
      const federatedInboxes = await filterFederatedUrls(database, inboxes)
      await Promise.all(
        federatedInboxes.map((inbox) =>
          sendAnnounce({ currentActor: actor, inbox, status })
        )
      )
    })
  }
)
