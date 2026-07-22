import { Database } from '@/lib/database/types'
import { SEND_QUOTE_REVOKE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { Status, getOriginalStatus } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getSpan } from '@/lib/utils/trace'

interface RevokeStatusQuoteFromUserInput {
  currentActor: Actor
  // The quoted status ([id]) — the caller must be its author.
  quotedStatusId: string
  // The quoting status ([quoting_status_id]) whose quote edge is revoked.
  quotingStatusId: string
  database: Database
}

export type RevokeStatusQuoteResult =
  | { ok: true; status: Status }
  | { ok: false; reason: 'forbidden' | 'not_found' }

/**
 * Quoted author revokes their approval of a quote of their status (Mastodon
 * `POST /statuses/:id/quotes/:quoting_status_id/revoke`). Author-only. Flips the
 * edge to `revoked` (idempotent; the stamp route stops serving once non-accepted)
 * and, when a hosted stamp exists, delivers a FEP-044f Delete of it to the
 * quoting author's inbox and every named recipient of the quoting note. Returns
 * the quoting status with `quote.state: 'revoked'`.
 */
export const revokeStatusQuoteFromUserInput = async ({
  currentActor,
  quotedStatusId,
  quotingStatusId,
  database
}: RevokeStatusQuoteFromUserInput): Promise<RevokeStatusQuoteResult> => {
  const span = getSpan('actions', 'revokeStatusQuoteFromUser', {
    quotedStatusId,
    quotingStatusId
  })

  const quotedStatus = await database.getStatus({
    statusId: quotedStatusId,
    withReplies: false
  })
  if (!quotedStatus) {
    span.end()
    return { ok: false, reason: 'not_found' }
  }
  if (getOriginalStatus(quotedStatus).actorId !== currentActor.id) {
    span.end()
    return { ok: false, reason: 'forbidden' }
  }

  // The edge must exist and actually link these two statuses.
  const edge = await database.getStatusQuote({ statusId: quotingStatusId })
  if (!edge || edge.quotedStatusId !== quotedStatusId) {
    span.end()
    return { ok: false, reason: 'not_found' }
  }

  // One-way state machine: accepted -> revoked; already-revoked is a no-op
  // (idempotent). `authorizationUri` is preserved so we can still address the
  // Delete below.
  await database.updateStatusQuoteState({
    statusId: quotingStatusId,
    state: 'revoked'
  })

  const quotingStatus = await database.getStatus({
    statusId: quotingStatusId,
    withReplies: false
  })
  if (!quotingStatus) {
    span.end()
    return { ok: false, reason: 'not_found' }
  }

  // Federate the stamp revocation (best-effort). The job fans the Delete out to
  // the quoting author's inbox and every named recipient of the quoting note, so
  // every server that saw the quote honors the revocation (FEP-044f). Only when
  // a hosted stamp was actually issued and the quoter is a different actor.
  const quotingActorId = getOriginalStatus(quotingStatus).actorId
  if (edge.authorizationUri && quotingActorId !== currentActor.id) {
    await getQueue().publish({
      id: getHashFromString(`${edge.authorizationUri}#revoke`),
      name: SEND_QUOTE_REVOKE_JOB_NAME,
      data: {
        actorId: currentActor.id,
        quotingActorId,
        quotingStatusId,
        stampId: edge.authorizationUri
      }
    })
  }

  span.end()
  return { ok: true, status: quotingStatus }
}
