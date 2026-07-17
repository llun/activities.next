import { QuoteRequest } from '@/lib/activities/quoteRequest'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  SEND_QUOTE_ACCEPT_JOB_NAME,
  SEND_QUOTE_REJECT_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { canQuoteStatus } from '@/lib/services/quotes/canQuoteStatus'
import { buildQuoteAuthorizationUri } from '@/lib/services/quotes/quoteAuthorization'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

type HandleQuoteRequestParams = {
  database: Database
  // The compacted inbound QuoteRequest activity.
  activity: unknown
  // The inbox owner (the quoted author).
  inboxActor: Actor
}

// Resolve the quoting note id from the QuoteRequest `instrument` (an embedded
// note object or a bare id string).
const getInstrumentId = (instrument: unknown): string | null => {
  if (typeof instrument === 'string') return instrument
  if (
    instrument &&
    typeof instrument === 'object' &&
    typeof (instrument as { id?: unknown }).id === 'string'
  ) {
    return (instrument as { id: string }).id
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

// Resolve the quoting note's author from the `instrument`, when embedded.
const getInstrumentAttributedTo = (instrument: unknown): string | null => {
  if (
    instrument &&
    typeof instrument === 'object' &&
    typeof (instrument as { attributedTo?: unknown }).attributedTo === 'string'
  ) {
    return (instrument as { attributedTo: string }).attributedTo
  }
  return null
}

/**
 * Author side of the FEP-044f handshake: a remote actor asks to quote one of the
 * inbox owner's statuses. Records the (pending) edge keyed on the quoting note,
 * evaluates the quote policy, and enqueues Accept (+ a hosted stamp) or Reject.
 * Returns true when handled, false when the request is not addressed to a local
 * status owned by the inbox actor.
 */
export const handleQuoteRequest = async ({
  database,
  activity,
  inboxActor
}: HandleQuoteRequestParams): Promise<boolean> => {
  const parsed = QuoteRequest.safeParse(activity)
  if (!parsed.success) return false
  const request = parsed.data

  const instrumentId = getInstrumentId(request.instrument)
  if (!instrumentId) return false

  // The quoting note must belong to the (HTTP-sig-verified) requester. A note is
  // served from its author's host, so the instrument id must be hosted under the
  // requester's authority in every case; when the note is embedded, its declared
  // attributedTo must additionally match the requester. `attributedTo` is itself
  // an attacker-controlled field of the embedded object, so it can never stand in
  // for the host binding — otherwise a requester could name a third party's note
  // (on any other host) as the instrument and forge/clobber that note's edge.
  if (!sameHost(instrumentId, request.actor)) return false
  const instrumentAuthor = getInstrumentAttributedTo(request.instrument)
  if (instrumentAuthor && instrumentAuthor !== request.actor) return false

  // An inbound QuoteRequest's instrument is always a remote note (local quotes
  // go through the create path). Reject an instrument on our own host — that
  // would be a forged claim over a local user's status id.
  try {
    if (new URL(instrumentId).host === getConfig().host) return false
  } catch {
    return false
  }

  // The quoted status (`object`) must be a local status owned by the inbox actor.
  const quotedStatus = await database.getStatus({
    statusId: request.object,
    withReplies: false
  })
  if (!quotedStatus || !quotedStatus.isLocalActor) return false
  if (quotedStatus.actorId !== inboxActor.id) return false

  // The requester must be able to read the quoted status (symmetric with the
  // local create route's canActorReadStatus gate): you cannot quote what you
  // cannot see. A non-audience actor for a followers-only/direct post is denied.
  const quotingActor = await database.getActorFromId({ id: request.actor })
  const canRead = await canActorReadStatus({
    database,
    status: quotedStatus,
    currentActor: quotingActor ?? null
  })
  if (!canRead) return false

  const verdict = await canQuoteStatus({
    database,
    quotedStatus,
    quotingActorId: request.actor
  })

  if (verdict === 'automatic') {
    const stampUri = buildQuoteAuthorizationUri(inboxActor.id, instrumentId)
    await database.createStatusQuote({
      statusId: instrumentId,
      quotedStatusId: request.object,
      state: 'accepted',
      quoteRequestId: request.id,
      authorizationUri: stampUri
    })
    await getQueue().publish({
      id: getHashFromString(`${request.id}#accept`),
      name: SEND_QUOTE_ACCEPT_JOB_NAME,
      data: {
        actorId: inboxActor.id,
        quotingActorId: request.actor,
        quoteRequestId: request.id,
        quotedStatusId: request.object,
        instrumentId,
        stampId: stampUri
      }
    })
    logger.info({
      message: 'Approved inbound quote request',
      quoteRequestId: request.id,
      quotingActorId: request.actor
    })
    return true
  }

  await database.createStatusQuote({
    statusId: instrumentId,
    quotedStatusId: request.object,
    state: 'rejected',
    quoteRequestId: request.id
  })
  await getQueue().publish({
    id: getHashFromString(`${request.id}#reject`),
    name: SEND_QUOTE_REJECT_JOB_NAME,
    data: {
      actorId: inboxActor.id,
      quotingActorId: request.actor,
      quoteRequestId: request.id,
      quotedStatusId: request.object,
      instrumentId
    }
  })
  logger.info({
    message: 'Rejected inbound quote request',
    quoteRequestId: request.id,
    quotingActorId: request.actor
  })
  return true
}
