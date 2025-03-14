import { z } from 'zod'

import { sendAnnounce } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobHandle } from '@/lib/services/queue/type'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string()
})

export const sendAnnounceJob: JobHandle = createJobHandle(
  SEND_ANNOUNCE_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendAnnounceJob', async (span) => {
      const { actorId, statusId } = JobData.parse(message.data)
      span.setAttribute('actorId', actorId)
      span.setAttribute('statusId', statusId)
      const [status, actor] = await Promise.all([
        database.getStatus({
          statusId,
          withReplies: false
        }),
        database.getActorFromId({
          id: actorId
        })
      ])
      if (!status || !actor) {
        span.recordException(new Error('Status or actor not found'))
        span.end()
        return
      }

      const inboxes = await database.getFollowersInbox({
        targetActorId: actorId
      })
      await Promise.all(
        inboxes.map((inbox) =>
          sendAnnounce({ currentActor: actor, inbox, status })
        )
      )
      span.end()
    })
  }
)
