import { z } from 'zod'

import { undoAnnounce } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { StatusType } from '@/lib/models/status'
import { JobHandle } from '@/lib/services/queue/type'
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
      await Promise.all(
        inboxes.map((inbox) =>
          undoAnnounce({ currentActor: actor, inbox, announce: status })
        )
      )
      span.end()
    })
  }
)
