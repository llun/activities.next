import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { UPDATE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { actorMatchesVerifiedSender } from '@/lib/jobs/verifiedSender'
import { JobHandle } from '@/lib/services/queue/type'
import { withSpan } from '@/lib/utils/trace'

const JobData = z.object({
  actorId: z.string()
})

// Applies an inbound Update(Person): the remote actor changed its profile, so
// re-fetch it now instead of waiting for the periodic stale refresh. The
// profile is read from the actor's own origin, never from the activity body,
// so the update cannot carry anything the origin does not itself serve.
export const updateActorJob: JobHandle = createJobHandle(
  UPDATE_ACTOR_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'updateActor', {}, async (span) => {
      const parsed = JobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed update actor job data'))
        return
      }
      const { actorId } = parsed.data
      span.setAttribute('actorId', actorId)
      if (!actorMatchesVerifiedSender(actorId, message)) {
        span.setAttribute('senderMismatch', true)
        return
      }

      // An actor we never stored has nothing to refresh, and a local actor's
      // profile is never rewritten from the network.
      const existingActor = await database.getActorFromId({ id: actorId })
      if (!existingActor || existingActor.privateKey) return

      await recordActorIfNeeded({ actorId, database, forceRefresh: true })
    })
  }
)
