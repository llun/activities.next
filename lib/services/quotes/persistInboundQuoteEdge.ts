import { BaseNote, getQuoteTargetId } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { verifyRemoteQuote } from '@/lib/services/quotes/verifyRemoteQuote'
import { Status } from '@/lib/types/domain/status'

type PersistInboundQuoteEdgeParams = {
  database: Database
  // The quoting note (already compacted at the inbox boundary).
  note: BaseNote
  // The quoting actor id (the note's attributedTo, normalized).
  actorId: string
  // The quoted status, if we already have it locally; null otherwise.
  quotedStatus: Status | null
  // The quoted status id the caller resolved from the note.
  quotedStatusId: string
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
 * Derive an inbound quote edge's state with the FEP-044f receiver rules and
 * write it, creating the edge or advancing an existing one. Shared by the
 * inbound Create and Update paths so a quote approval that arrives on either
 * activity settles identically — an Update is how a quoter re-federates its
 * note once the quoted author's Accept has handed it a `quoteAuthorization`
 * stamp, so the two must agree.
 *
 * The edge is advanced through the one-way state machine in
 * `updateStatusQuoteState`, so a re-derived `pending` (an Update that arrives
 * with no stamp, a stamp fetch that failed) can never downgrade an edge that is
 * already accepted, rejected, revoked or deleted.
 */
export const persistInboundQuoteEdge = async ({
  database,
  note,
  actorId,
  quotedStatus,
  quotedStatusId
}: PersistInboundQuoteEdgeParams): Promise<void> => {
  const state = await verifyRemoteQuote({
    database,
    note,
    actorId,
    quotedStatus
  })
  // Only trust an inbound stamp uri when the quote actually verified as
  // accepted AND the stamp is served from the quoted status's own authority. A
  // remote note can claim any `quoteAuthorization`; persisting it on a
  // pending/rejected or cross-authority edge would let a forged note shadow a
  // legitimate stamp (the authorizationUri index is non-unique).
  const authorizationUri =
    state === 'accepted' &&
    note.quoteAuthorization &&
    sameHost(note.quoteAuthorization, quotedStatusId)
      ? note.quoteAuthorization
      : undefined

  const existingEdge = await database.getStatusQuote({ statusId: note.id })
  if (existingEdge) {
    await database.updateStatusQuoteState({
      statusId: note.id,
      state,
      authorizationUri
    })
    return
  }
  await database.createStatusQuote({
    statusId: note.id,
    quotedStatusId,
    state,
    authorizationUri: authorizationUri ?? null
  })
}

/**
 * Re-derive the quote edge for a note arriving on an inbound Update. Unlike the
 * Create path this never dereferences the quoted note: an Update is an
 * unsolicited re-federation, so it must not be able to drive outbound fetches.
 * A quote whose target this instance has never stored therefore stays pending
 * until the quoted note reaches us some other way.
 */
export const syncQuoteEdgeFromUpdate = async ({
  database,
  note,
  actorId
}: Omit<
  PersistInboundQuoteEdgeParams,
  'quotedStatus' | 'quotedStatusId'
>): Promise<void> => {
  const quotedStatusId = getQuoteTargetId(note)
  if (!quotedStatusId) return

  // Nothing to advance when no edge exists: the Create path owns edge creation
  // (including the bounded fetch of an unknown quoted note), and an Update is
  // not a place to start a quote relationship this instance never recorded.
  const existingEdge = await database.getStatusQuote({ statusId: note.id })
  if (!existingEdge || existingEdge.state !== 'pending') return
  if (existingEdge.quotedStatusId !== quotedStatusId) return

  const quotedStatus = await database.getStatus({
    statusId: quotedStatusId,
    withReplies: false
  })
  await persistInboundQuoteEdge({
    database,
    note,
    actorId,
    quotedStatus,
    quotedStatusId
  })
}
