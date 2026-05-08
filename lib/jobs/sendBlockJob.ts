import { z } from 'zod'

import { block } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_BLOCK_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  targetActorId: z.string(),
  uri: z.string()
})

export const sendBlockJob: JobHandle = createJobHandle(
  SEND_BLOCK_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendBlockJob', async (span) => {
      const { actorId, targetActorId, uri } = JobData.parse(message.data)
      span.setAttribute('actorId', actorId)
      span.setAttribute('targetActorId', targetActorId)
      span.setAttribute('uri', uri)

      if (!(await canFederateWithDomain(database, targetActorId))) {
        span.end()
        return
      }

      const [currentActor, signingActor] = await Promise.all([
        database.getActorFromId({ id: actorId }),
        getFederationSigningActor(database)
      ])
      if (!currentActor) {
        span.recordException(new Error('Actor not found'))
        span.end()
        return
      }

      await block({
        uri,
        currentActor,
        targetActorId,
        signingActor
      })
      span.end()
    })
  }
)
