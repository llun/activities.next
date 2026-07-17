import { z } from 'zod'

import { getNote, sendQuoteRequest } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { loadStatusAndActor } from '@/lib/jobs/loadStatusAndActor'
import { SEND_QUOTE_REQUEST_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  actorId: z.string(),
  statusId: z.string(),
  quotedStatusId: z.string()
})

// Local user quoted a remote status: send the FEP-044f QuoteRequest to the
// quoted author's inbox. The remote's Accept/Reject settles the pending edge.
export const sendQuoteRequestJob: JobHandle = createJobHandle(
  SEND_QUOTE_REQUEST_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendQuoteRequestJob', async (span) => {
      const { actorId, statusId, quotedStatusId } = JobData.parse(message.data)

      if (!(await canFederateWithDomain(database, quotedStatusId))) {
        span.end()
        return
      }

      const [{ status, actor }, signingActor] = await Promise.all([
        loadStatusAndActor(database, span, { actorId, statusId }),
        getFederationSigningActor(database)
      ])
      if (!status || !actor) {
        span.end()
        return
      }

      const instrument = getNoteFromStatus(status)
      if (!instrument) {
        span.end()
        return
      }

      // Resolve the quoted author: prefer a locally cached copy of the quoted
      // status, otherwise dereference the note itself.
      const quotedStatus = await database.getStatus({
        statusId: quotedStatusId,
        withReplies: false
      })
      const quotedAuthorId =
        quotedStatus?.actorId ??
        (await getNote({ statusId: quotedStatusId, signingActor }))
          ?.attributedTo
      if (typeof quotedAuthorId !== 'string') {
        span.end()
        return
      }

      const person = await getActorPerson({
        actorId: quotedAuthorId,
        signingActor
      })
      const inbox = person?.inbox ?? `${quotedAuthorId}/inbox`

      await sendQuoteRequest({
        currentActor: actor,
        inbox,
        quoteRequestId: `${statusId}#quote-request`,
        quotedStatusId,
        instrument
      })

      span.end()
    })
  }
)
