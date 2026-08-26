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
      // closed if it cannot be resolved.
      //
      // This branch is purely ADDITIVE: it never returns, on either outcome. A
      // stored `authorizationUri` is remote-supplied and only ever same-host
      // checked, so an id naming a real actor or status CAN sit in that column
      // — planted, or a peer simply echoing the quoted status in an Accept's
      // `result`. Consuming the activity here would swallow that object's own
      // legitimate Delete forever, and no retry could ever get past it. Falling
      // through costs nothing: a genuine stamp uri names no actor or status, so
      // every path below is a no-op for it, and each is independently scoped to
      // the verified sender.
      // Set when this Delete really was a quote revocation. The fall-through
      // below must still RUN — a planted id names a real actor or status that
      // deserves its delete — while the two paths a legitimate revocation
      // actually reaches must not REPORT it as junk: the string path (where the
      // value compared IS the stamp uri, so a mismatch is structurally
      // guaranteed) and the terminal branch (where the FEP-044f object shape
      // parses as neither Tombstone nor Announce). This is NOT a blanket rule:
      // the Announce branch deliberately still reports — see its own comment —
      // because no legitimate revocation shape can reach it.
      let revokedQuote = false
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
            revokedQuote = true
          } else {
            span.setAttribute('quoteRevocationSenderMismatch', true)
          }
        }
      }

      if (typeof data === 'string') {
        if (!actorMatchesVerifiedSender(data, message)) {
          // Not a mismatch when we just revoked: `senderMismatch` means someone
          // tried to delete something they do not own, and the quoted author
          // deleting their own stamp is the opposite of that.
          if (!revokedQuote) span.setAttribute('senderMismatch', true)
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
          // Reported unconditionally, unlike the string path above: an Announce
          // is a boost and never a stamp, so no legitimate revocation shape
          // reaches here. Arriving with `revokedQuote` set means someone stored
          // a third party's Announce id as an authorizationUri and is now
          // deleting an object they do not own — precisely the case the
          // attribute exists to surface.
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

      // A revocation that reached here is not invalid data: the FEP-044f shape
      // `{ id, type: 'QuoteAuthorization' }` — what our own sendQuoteRevoke
      // emits — is neither a Tombstone nor an Announce, so without this every
      // successful revocation would record an exception on its span and read as
      // a job failure in tracing.
      if (revokedQuote) return
      span.recordException(new Error('Invalid data'))
      span.setAttribute('data', JSON.stringify(data))
    })
  }
)
