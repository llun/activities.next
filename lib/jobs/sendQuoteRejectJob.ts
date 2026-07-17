import { z } from 'zod'

import { sendQuoteReject } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_QUOTE_REJECT_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  // The quoted author (inbox owner) who declines the quote.
  actorId: z.string(),
  // The quoter we reply to.
  quotingActorId: z.string(),
  // The received QuoteRequest fields, echoed back as the Reject `object`.
  quoteRequestId: z.string(),
  quotedStatusId: z.string(),
  instrumentId: z.string()
})

// Author side of the handshake: decline the quote.
export const sendQuoteRejectJob: JobHandle = createJobHandle(
  SEND_QUOTE_REJECT_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendQuoteRejectJob', async (span) => {
      const {
        actorId,
        quotingActorId,
        quoteRequestId,
        quotedStatusId,
        instrumentId
      } = JobData.parse(message.data)

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

      await sendQuoteReject({
        currentActor,
        inbox,
        quoteRequest: {
          id: quoteRequestId,
          type: 'QuoteRequest',
          actor: quotingActorId,
          object: quotedStatusId,
          instrument: instrumentId
        }
      })

      span.end()
    })
  }
)
