import { z } from 'zod'

import { sendQuoteRevoke } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SEND_QUOTE_REVOKE_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { getExplicitRecipientInboxes } from '@/lib/services/federation/statusDelivery'
import { JobHandle } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'
import { getTracer } from '@/lib/utils/trace'

export const JobData = z.object({
  // The quoted author revoking their approval (signs the Delete).
  actorId: z.string(),
  // The quoting note's author, whose inbox always receives the stamp Delete.
  quotingActorId: z.string(),
  // The quoting note whose named (to/cc) recipients also receive the Delete so
  // every server that saw the quote honors the revocation (FEP-044f). Optional
  // for backward compatibility with jobs queued before fan-out (author-only).
  quotingStatusId: z.string().optional(),
  // The hosted QuoteAuthorization stamp id being revoked.
  stampId: z.string()
})

// Quoted-author side: withdraw a previously-issued QuoteAuthorization by
// delivering a Delete of the stamp (FEP-044f). The Delete is fanned out to the
// quoting author's inbox AND every named (to/cc) recipient of the quoting note,
// so any third-party server that received the quote un-approves it. Every copy
// is signed by the quoted author (`currentActor`), which is exactly what the
// receiving side (deleteObjectJob) requires: it revokes only when the Delete's
// verified sender is the quoted status's own author. The signer must never
// change per destination.
export const sendQuoteRevokeJob: JobHandle = createJobHandle(
  SEND_QUOTE_REVOKE_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('sendQuoteRevokeJob', async (span) => {
      const { actorId, quotingActorId, quotingStatusId, stampId } =
        JobData.parse(message.data)

      if (!(await canFederateWithDomain(database, quotingActorId))) {
        span.end()
        return
      }

      const [currentActor, signingActor, quotingStatus] = await Promise.all([
        database.getActorFromId({ id: actorId }),
        getFederationSigningActor(database),
        quotingStatusId
          ? database.getStatus({
              statusId: quotingStatusId,
              withReplies: false
            })
          : Promise.resolve(null)
      ])
      if (!currentActor) {
        span.end()
        return
      }

      // The quoting author's own inbox is always delivered (their server
      // propagates to its follower audience, which we cannot enumerate).
      const person = await getActorPerson({
        actorId: quotingActorId,
        signingActor
      })
      const authorInbox = person?.inbox ?? `${quotingActorId}/inbox`

      // Plus the quoting note's named third-party recipients.
      const recipientInboxes = quotingStatus
        ? await getExplicitRecipientInboxes({
            database,
            currentActor,
            status: quotingStatus
          })
        : []

      const inboxes = [...new Set([authorInbox, ...recipientInboxes])]

      await Promise.all(
        inboxes.map(async (inbox) => {
          try {
            await sendQuoteRevoke({ currentActor, inbox, stampId })
          } catch (error) {
            logger.error({
              message: 'Failed to send quote revoke',
              inbox,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        })
      )

      span.end()
    })
  }
)
