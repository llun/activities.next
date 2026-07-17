import { z } from 'zod'

import { sendQuoteAccept } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_QUOTE_ACCEPT_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  // The quoted author (inbox owner) who approves the quote.
  actorId: z.string(),
  // The quoter we reply to.
  quotingActorId: z.string(),
  // The received QuoteRequest fields, echoed back as the Accept `object`.
  quoteRequestId: z.string(),
  quotedStatusId: z.string(),
  instrumentId: z.string(),
  // The hosted QuoteAuthorization stamp id (the Accept `result`).
  stampId: z.string()
})

// Author side of the handshake: send Accept + the hosted stamp to the quoter.
export const sendQuoteAcceptJob: JobHandle = createJobHandle(
  SEND_QUOTE_ACCEPT_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendQuoteAcceptJob', async (span) => {
      const {
        actorId,
        quotingActorId,
        quoteRequestId,
        quotedStatusId,
        instrumentId,
        stampId
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

      await sendQuoteAccept({
        currentActor,
        inbox,
        quoteRequest: {
          id: quoteRequestId,
          type: 'QuoteRequest',
          actor: quotingActorId,
          object: quotedStatusId,
          instrument: instrumentId
        },
        stampId
      })

      span.end()
    })
  }
)
