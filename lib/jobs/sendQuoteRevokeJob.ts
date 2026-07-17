import { z } from 'zod'

import { sendQuoteRevoke } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_QUOTE_REVOKE_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  // The quoted author revoking their approval (signs the Delete).
  actorId: z.string(),
  // The quoting note's author, whose inbox receives the stamp Delete.
  quotingActorId: z.string(),
  // The hosted QuoteAuthorization stamp id being revoked.
  stampId: z.string()
})

// Quoted-author side: withdraw a previously-issued QuoteAuthorization by
// delivering a Delete of the stamp to the quoting author's inbox (FEP-044f).
export const sendQuoteRevokeJob: JobHandle = createJobHandle(
  SEND_QUOTE_REVOKE_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendQuoteRevokeJob', async (span) => {
      const { actorId, quotingActorId, stampId } = JobData.parse(message.data)

      if (!(await canFederateWithDomain(database, quotingActorId))) {
        span.end()
        return
      }

      const [currentActor, signingActor] = await Promise.all([
        database.getActorFromId({ id: actorId }),
        getFederationSigningActor(database)
      ])
      if (!currentActor) {
        span.end()
        return
      }

      const person = await getActorPerson({
        actorId: quotingActorId,
        signingActor
      })
      const inbox = person?.inbox ?? `${quotingActorId}/inbox`

      await sendQuoteRevoke({ currentActor, inbox, stampId })

      span.end()
    })
  }
)
