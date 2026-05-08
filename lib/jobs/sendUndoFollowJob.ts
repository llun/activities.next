import { z } from 'zod'

import { unfollow } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_UNDO_FOLLOW_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { JobHandle } from '@/lib/services/queue/type'
import { Follow } from '@/lib/types/domain/follow'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  follow: Follow
})

export const sendUndoFollowJob: JobHandle = createJobHandle(
  SEND_UNDO_FOLLOW_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendUndoFollowJob', async (span) => {
      const { actorId, follow } = JobData.parse(message.data)
      span.setAttribute('actorId', actorId)
      span.setAttribute('followId', follow.id)

      if (!(await canFederateWithDomain(database, follow.targetActorId))) {
        span.end()
        return
      }

      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        span.recordException(new Error('Actor not found'))
        span.end()
        return
      }

      const ok = await unfollow(actor, follow)
      if (!ok) {
        const error = new Error('Failed to send Undo Follow')
        span.recordException(error)
        span.end()
        throw error
      }
      span.end()
    })
  }
)
