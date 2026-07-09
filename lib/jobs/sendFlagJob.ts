import { z } from 'zod'

import { sendFlag } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_FLAG_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  reportId: z.string(),
  targetActorId: z.string(),
  statusIds: z.array(z.string()),
  content: z.string()
})

export const sendFlagJob: JobHandle = createJobHandle(
  SEND_FLAG_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendFlagJob', async (span) => {
      const { reportId, targetActorId, statusIds, content } = JobData.parse(
        message.data
      )
      span.setAttribute('reportId', reportId)
      span.setAttribute('targetActorId', targetActorId)

      if (!(await canFederateWithDomain(database, targetActorId))) {
        span.end()
        return
      }

      const targetActor = await database.getActorFromId({ id: targetActorId })
      // A local target (identified by a stored private key) is handled in-app;
      // there is no remote inbox to forward the Flag to.
      if (targetActor?.privateKey) {
        span.end()
        return
      }

      // Forward as the headless instance actor so the reporter stays anonymous
      // (Mastodon forwards Flags from the instance representative).
      const signingActor = await getFederationSigningActor(database)
      if (!signingActor) {
        span.recordException(new Error('Federation signing actor not found'))
        span.end()
        return
      }

      const uri = `${signingActor.id}#reports/${reportId}`
      const result = await sendFlag({
        uri,
        currentActor: signingActor,
        targetActorId,
        // The reported actor plus every reported status URI.
        objects: [targetActorId, ...statusIds],
        content,
        signingActor
      })
      if (!result.ok) {
        const error = new Error('Failed to send Flag')
        span.recordException(error)
        span.end()
        throw error
      }
      span.end()
    })
  }
)
