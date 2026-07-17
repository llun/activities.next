import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getOriginalStatus } from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

type HandleQuoteResponseParams = {
  database: Database
  // The compacted inbound Accept/Reject activity.
  activity: unknown
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
  activity
}: HandleQuoteResponseParams): Promise<boolean> => {
  const record = activity as Record<string, unknown>
  const type = record.type
  if (type !== 'Accept' && type !== 'Reject') return false

  const quoteRequestId = refId(record.object)
  if (!quoteRequestId) return false

  const edge = await database.getStatusQuoteByQuoteRequestId({ quoteRequestId })
  if (!edge) return false

  // Authorization: only the quoted status's own author may settle our quote —
  // otherwise any validly-signed third party could forge an Accept/Reject of our
  // pending outbound quote (and inject an attacker-controlled stamp). Match the
  // responder against the quoted status's author when we have it locally (we
  // always do at request time), falling back to same-host authority.
  const responder = refId(record.actor)
  if (!responder) return false
  const quotedStatus = await database.getStatus({
    statusId: edge.quotedStatusId,
    withReplies: false
  })
  const quotedAuthorId = quotedStatus
    ? getOriginalStatus(quotedStatus).actorId
    : null
  const authorized = quotedAuthorId
    ? normalizeActorId(responder) === normalizeActorId(quotedAuthorId)
    : sameHost(responder, edge.quotedStatusId)
  if (!authorized) return false

  if (type === 'Accept') {
    const stampUri = refId(record.result)
    // Only store a stamp hosted under the quoted author's own authority.
    const authorizationUri =
      stampUri && sameHost(stampUri, edge.quotedStatusId) ? stampUri : undefined
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
