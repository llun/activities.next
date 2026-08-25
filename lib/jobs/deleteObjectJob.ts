import { Announce, Tombstone } from '@/lib/types/activitypub'
import { getOriginalStatus } from '@/lib/types/domain/status'
import {
  normalizeActivityPubAnnounce,
  normalizeActorId
} from '@/lib/utils/activitypub'
import { withSpan } from '@/lib/utils/trace'

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
    await withSpan('job', 'deleteObject', {}, async (span) => {
      const data = message.data

      // FEP-044f revocation: a Delete of a QuoteAuthorization stamp revokes the
      // quote. Match the deleted object against a stored stamp uri and require
      // the revoker to be the quoted status's own author (the party that issued
      // the stamp). Host equality is not enough on a multi-user instance — a
      // co-resident of the quoted author would otherwise be able to revoke
      // someone else's authorized quote — so resolve the exact author and fail
      // closed if it cannot be resolved. Runs before the actor/status delete
      // paths, but must never CONSUME the activity on their behalf: a stored
      // stamp uri is remote-supplied, so a status or actor id CAN match one.
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
            return
          }
          // Sender is not the quoted author, so this is not a revocation of
          // that quote. Fall THROUGH to the normal delete paths rather than
          // returning: `authorizationUri` is remote-supplied and only ever
          // same-host checked against the quoted status, so a hostile actor can
          // plant an id belonging to a co-resident actor or status there and
          // have this branch swallow that object's own legitimate Delete
          // forever. `handleQuoteResponse` now verifies an Accept's `result`
          // before storing it, but `persistInboundQuoteEdge` still cannot:
          // `verifyRemoteQuote`'s self-quote shortcut returns `accepted` without
          // reading any stamp, so an actor quoting their OWN status can persist
          // an arbitrary same-host uri. This fall-through is what makes that
          // harmless, so do not restore the early return.
          span.setAttribute('quoteRevocationSenderMismatch', true)
        }
      }

      if (typeof data === 'string') {
        if (!actorMatchesVerifiedSender(data, message)) {
          span.setAttribute('senderMismatch', true)
          return
        }

        span.setAttribute('actorId', data)
        await database.deleteActor({
          actorId: data
        })
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
        return
      }

      const announceResult = Announce.safeParse(
        normalizeActivityPubAnnounce(data)
      )
      if (announceResult.success) {
        const announce = announceResult.data
        if (!actorMatchesVerifiedSender(announce.actor, message)) {
          span.setAttribute('senderMismatch', true)
          return
        }

        span.setAttribute('statusId', announce.id)
        await database.deleteStatus({
          statusId: announce.id,
          actorId: getVerifiedSenderActorId(message.verifiedSenderActorId)
        })
        return
      }

      span.recordException(new Error('Invalid data'))
      span.setAttribute('data', JSON.stringify(data))
    })
  }
)
