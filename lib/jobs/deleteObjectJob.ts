import { Announce, Tombstone } from '@/lib/types/activitypub'
import { getOriginalStatus } from '@/lib/types/domain/status'
import {
  normalizeActivityPubAnnounce,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { getTracer } from '@/lib/utils/trace'

import { createJobHandle } from './createJobHandle'
import { DELETE_OBJECT_JOB_NAME } from './names'
import { actorMatchesVerifiedSender } from './verifiedSender'

// Undefined intentionally preserves unscoped deletes for legacy queued messages.
const getVerifiedSenderActorId = (actorId?: string) =>
  normalizeActorId(actorId) ?? undefined

// Extract a possible stamp uri from the Delete object (a bare id string or an
// object with an id, e.g. a Tombstone/QuoteAuthorization).
const getStampUri = (data: unknown): string | null => {
  if (typeof data === 'string') return data
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as { id?: unknown }).id === 'string'
  ) {
    return (data as { id: string }).id
  }
  return null
}

export const deleteObjectJob = createJobHandle(
  DELETE_OBJECT_JOB_NAME,
  async (database, message) => {
    await getTracer().startActiveSpan('deleteObject', async (span) => {
      const data = message.data

      // FEP-044f revocation: a Delete of a QuoteAuthorization stamp revokes the
      // quote. Match the deleted object against a stored stamp uri and require
      // the revoker to be the quoted status's own author (the party that issued
      // the stamp). Host equality is not enough on a multi-user instance — a
      // co-resident of the quoted author would otherwise be able to revoke
      // someone else's authorized quote — so resolve the exact author and fail
      // closed if it cannot be resolved. Runs before the actor/status delete
      // paths; a status/actor id never matches a stored stamp uri.
      const stampUri = getStampUri(data)
      if (stampUri) {
        const edge = await database.getStatusQuoteByAuthorizationUri({
          authorizationUri: stampUri
        })
        if (edge) {
          const verifiedSenderActorId = message.verifiedSenderActorId
          const quotedStatus = verifiedSenderActorId
            ? await database.getStatus({
                statusId: edge.quotedStatusId,
                withReplies: false
              })
            : null
          const quotedAuthorId = quotedStatus
            ? getOriginalStatus(quotedStatus).actorId
            : null
          if (
            verifiedSenderActorId &&
            quotedAuthorId &&
            normalizeActorId(verifiedSenderActorId) ===
              normalizeActorId(quotedAuthorId)
          ) {
            await database.updateStatusQuoteState({
              statusId: edge.statusId,
              state: 'revoked'
            })
            span.setAttribute('revokedQuoteStatusId', edge.statusId)
          } else {
            span.setAttribute('quoteRevocationSenderMismatch', true)
          }
          span.end()
          return
        }
      }

      if (typeof data === 'string') {
        if (!actorMatchesVerifiedSender(data, message)) {
          span.setAttribute('senderMismatch', true)
          span.end()
          return
        }

        span.setAttribute('actorId', data)
        await database.deleteActor({
          actorId: data
        })
        span.end()
        return
      }

      const tombStoneResult = Tombstone.safeParse(data)
      if (tombStoneResult.success) {
        const tombStone = tombStoneResult.data
        span.setAttribute('statusId', tombStone.id)
        await database.deleteStatus({
          statusId: tombStone.id,
          actorId: getVerifiedSenderActorId(message.verifiedSenderActorId)
        })
        span.end()
        return
      }

      const announceResult = Announce.safeParse(
        normalizeActivityPubAnnounce(data)
      )
      if (announceResult.success) {
        const announce = announceResult.data
        if (!actorMatchesVerifiedSender(announce.actor, message)) {
          span.setAttribute('senderMismatch', true)
          span.end()
          return
        }

        span.setAttribute('statusId', announce.id)
        await database.deleteStatus({
          statusId: announce.id,
          actorId: getVerifiedSenderActorId(message.verifiedSenderActorId)
        })
        span.end()
        return
      }

      span.recordException(new Error('Invalid data'))
      span.setAttribute('data', JSON.stringify(data))
      span.end()
    })
  }
)
