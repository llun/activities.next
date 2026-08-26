import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { verifyQuoteAuthorizationStamp } from '@/lib/services/quotes/verifyRemoteQuote'
import { getOriginalStatus } from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

type HandleQuoteResponseParams = {
  database: Database
  // The compacted inbound Accept/Reject activity.
  activity: unknown
  // The actor the HTTP signature actually proved, from the inbox guard. This is
  // the ONLY trustworthy identity here — see the authorization note below.
  verifiedSenderActorId: string
}

// Read a bare id or an embedded `{ id }` reference.
const refId = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  ) {
    return (value as { id: string }).id
  }
  return null
}

// Two ids share authority when served from the same host.
const sameHost = (a: string, b: string): boolean => {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

/**
 * Quoter side of the FEP-044f handshake: match an inbound Accept/Reject against
 * one of our pending outbound QuoteRequests (by `object` == quoteRequestId). On
 * Accept, store the hosted stamp uri (`result`) and re-federate our note so it
 * carries `quoteAuthorization`; on Reject, mark the edge rejected. Returns true
 * when the activity matched a quote (so the caller skips the follow path), false
 * otherwise.
 */
export const handleQuoteResponse = async ({
  database,
  activity,
  verifiedSenderActorId
}: HandleQuoteResponseParams): Promise<boolean> => {
  const record = activity as Record<string, unknown>
  const type = record.type
  if (type !== 'Accept' && type !== 'Reject') return false

  const quoteRequestId = refId(record.object)
  if (!quoteRequestId) return false

  const edge = await database.getStatusQuoteByQuoteRequestId({ quoteRequestId })
  if (!edge) return false

  // Authorization: only the quoted status's own author may settle our quote —
  // otherwise any validly-signed third party (including a co-resident of the
  // quoted author) could forge an Accept/Reject of our pending outbound quote
  // (and inject an attacker-controlled stamp). Require an exact author match; if
  // we cannot resolve the author locally, fail closed rather than trust same-host
  // authority (host equality is not authorship on a multi-user instance).
  //
  // The identity compared is the signature-VERIFIED sender, never this
  // document's own `actor`. The inbox guard verifies `actor` on the RAW body,
  // but what reaches here is the COMPACTED document, and a sender-supplied
  // JSON-LD context can alias `actor` to a different value than the one signed
  // for — proven: a document signed by `mallory` whose context points the
  // literal `actor` term at a junk IRI and aliases another key onto `as:actor`
  // compacts to `actor: alice`. Trusting that field let any federatable actor
  // forge the quoted author's approval of a pending quote, and the quoteRequestId
  // it keys on is derivable from the public quoting post's URL.
  const quotedStatus = await database.getStatus({
    statusId: edge.quotedStatusId,
    withReplies: false
  })
  const quotedAuthorId = quotedStatus
    ? getOriginalStatus(quotedStatus).actorId
    : null
  if (!quotedAuthorId) return false
  if (
    normalizeActorId(verifiedSenderActorId) !== normalizeActorId(quotedAuthorId)
  ) {
    return false
  }

  if (type === 'Accept') {
    // Only a `pending` edge has anything to settle. The state machine discards
    // every other transition anyway, and this returns before the stamp fetch
    // below — otherwise a verified quoted author could replay one Accept
    // indefinitely and make us re-fetch on each, inline in the inbox request.
    //
    // Known cost: it also skips the re-federation below, so if a first Accept's
    // write committed but its publish failed, a replayed Accept no longer heals
    // it. Keeping the publish would be worse — it hands that same actor a
    // fan-out amplifier, one replay delivering an Update to every recipient of
    // our note, inline under the default in-process queue.
    if (edge.state !== 'pending') return true

    const stampUri = refId(record.result)
    // Store the stamp only once it is hosted under the quoted author's
    // authority AND has not been DISPROVED: a same-host check alone let a
    // hostile quoted author pass off any co-resident id — an actor or a status
    // — as the stamp, which `deleteObjectJob` matches when deciding whether an
    // inbound Delete is a quote revocation.
    //
    // `unavailable` deliberately still stores it. The check cannot disprove a
    // stamp it could not read, and dropping it is irreversible: this edge goes
    // `pending → accepted` here, `accepted → accepted` is a no-op, so no later
    // Accept can ever supply the stamp. One transient 503 would otherwise strip
    // `quoteAuthorization` from every federated copy of our note for good and
    // leave every receiver rendering an approved quote as unapproved — the
    // exact failure this whole change exists to fix. That trade is only safe
    // because a planted uri can no longer swallow an unrelated Delete.
    const stampCheck =
      stampUri && sameHost(stampUri, edge.quotedStatusId)
        ? await verifyQuoteAuthorizationStamp({
            database,
            stampUri,
            quotedAuthorId,
            quotingStatusId: edge.statusId,
            quotedStatusId: edge.quotedStatusId
          })
        : 'mismatch'
    const authorizationUri =
      stampUri && stampCheck !== 'mismatch' ? stampUri : undefined
    if (stampCheck === 'unavailable') {
      logger.warn({
        message:
          'Storing an unverified quote authorization stamp: it could not be read',
        statusId: edge.statusId,
        stampUri
      })
    }
    await database.updateStatusQuoteState({
      statusId: edge.statusId,
      state: 'accepted',
      authorizationUri
    })
    // Re-federate the quoting note so it now advertises the stamp.
    const status = await database.getStatus({
      statusId: edge.statusId,
      withReplies: false
    })
    if (status) {
      await getQueue().publish({
        id: getHashFromString(`${edge.statusId}#quote-accepted`),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: { actorId: status.actorId, statusId: edge.statusId }
      })
    }
    logger.info({
      message: 'Quote request accepted by remote author',
      statusId: edge.statusId
    })
    return true
  }

  await database.updateStatusQuoteState({
    statusId: edge.statusId,
    state: 'rejected'
  })
  logger.info({
    message: 'Quote request rejected by remote author',
    statusId: edge.statusId
  })
  return true
}
