import { getNote } from '@/lib/activities'
import { BaseNote, getQuoteTargetId } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { verifyRemoteQuote } from '@/lib/services/quotes/verifyRemoteQuote'
import { Status } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Stores a quoted note this instance fetched. Injected by the caller because
// storing one means running the inbound Create path, which lives in
// `lib/jobs/createNoteJob` — importing it here would close a cycle.
//
// The `bound` argument is supplied BY the resolver and must be forwarded into
// the stored note's job message: it is what stops that note from chasing its
// own quote target, so an attacker-controlled chain of quoting notes (A quotes
// B quotes C …) cannot drive unbounded recursive fetches. Passing it in rather
// than letting each call site remember it keeps the bound with the code that
// does the fetching.
export type StoreFetchedQuotedNote = (
  note: BaseNote,
  bound: { skipQuoteResolution: true }
) => Promise<void>

type PersistInboundQuoteEdgeParams = {
  database: Database
  // The quoting note (already compacted at the inbox boundary).
  note: BaseNote
  // The quoting actor id. The Create path derives it from the note's
  // `attributedTo`; the Update path deliberately passes the note's STORED
  // author instead (see `syncQuoteEdgeFromUpdate`).
  actorId: string
  // The quoted status, if we have it locally; null otherwise.
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
 * Fetch and store the quoted note when this instance does not already have it,
 * so `verifyRemoteQuote` can confirm the quoted author and the quote card can
 * load the content. Without it a stamped quote of a post we never stored is
 * stuck `pending` even though it was legitimately approved.
 *
 * Bounded deliberately: it runs only when the note carries a stamp worth
 * verifying, and `skipQuoteResolution` stops the stored note from chasing its
 * own quote target, so a chain of quoting notes (A quotes B quotes C …) cannot
 * drive unbounded recursive fetches. Any failure (a federation-blocked domain,
 * a store error) leaves the result null and degrades the edge to `pending`
 * rather than throwing and orphaning the note.
 *
 * Fetching only makes the author knowable — the stamp is still validated by
 * `verifyRemoteQuote`, so a fetch never grants trust on its own.
 */
export const resolveInboundQuotedStatus = async ({
  database,
  note,
  quotedStatusId,
  storeNote
}: {
  database: Database
  note: BaseNote
  quotedStatusId: string
  storeNote: StoreFetchedQuotedNote
}): Promise<Status | null> => {
  const stored = await database.getStatus({
    statusId: quotedStatusId,
    withReplies: false
  })
  if (stored) return stored
  if (!note.quoteAuthorization) return null

  try {
    const signingActor = await getFederationSigningActor(database)
    const fetchedQuotedNote = await getNote({
      statusId: quotedStatusId,
      signingActor
    })
    if (!fetchedQuotedNote) return null
    // A redirect or alias must not let a different note stand in for the id we
    // asked for — the same guard `verifyQuoteInstrument` applies. Without it the
    // fetched document names its own id and author, so a quoter could point at a
    // decoy that answers with `attributedTo: <someone else>` and have this
    // instance store, attribute and fan out a status that actor never wrote.
    // Nothing downstream re-checks: the note reaches `createNoteJob` with no
    // verified sender, which fail-opens `actorMatchesVerifiedSender`.
    if (fetchedQuotedNote.id !== quotedStatusId) return null
    await storeNote(fetchedQuotedNote, { skipQuoteResolution: true })
    // `return await`, never a bare `return` of the promise: inside a `try` the
    // latter settles this function's promise after the catch frame is gone, so
    // a rejection here would escape and throw out of the inbound job — orphaning
    // a note that was already committed but never reached a timeline.
    return await database.getStatus({
      statusId: quotedStatusId,
      withReplies: false
    })
  } catch (error) {
    logger.warn({
      message:
        'Failed to fetch quoted note for inbound quote; leaving the edge pending',
      quotedStatusId,
      err: toLoggableError(error),
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

/**
 * Derive an inbound quote edge's state with the FEP-044f receiver rules and
 * write it, creating the edge or advancing an existing one. Shared by the
 * inbound Create and Update paths so a quote approval that arrives on either
 * settles identically — an Update is how a quoter re-federates its note once
 * the quoted author's Accept has handed it a `quoteAuthorization` stamp, so the
 * two must agree.
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
 * Re-derive the quote edge for a note arriving on an inbound Update — the
 * activity a quoter re-federates once an Accept has handed it a stamp.
 *
 * Only an edge this instance already recorded, still `pending`, and still
 * pointing at the same target is advanced. Edge CREATION stays with the Create
 * path: an Update is not a place to start a quote relationship we never
 * recorded, and refusing to re-point an existing one fails closed (Mastodon
 * does not permit changing a quote target on edit).
 *
 * Those guards also bound what this can dereference. The quoted note is fetched
 * (as on the Create path) only for `existingEdge.quotedStatusId` — a value this
 * instance stored, not one the Update supplies — so an Update can never name an
 * arbitrary URL to fetch. Note the stamp fetch inside `verifyRemoteQuote` is
 * reachable from here either way; this path is not, and never was, fetch-free.
 */
export const syncQuoteEdgeFromUpdate = async ({
  database,
  note,
  actorId,
  storeNote
}: Omit<PersistInboundQuoteEdgeParams, 'quotedStatus' | 'quotedStatusId'> & {
  storeNote: StoreFetchedQuotedNote
}): Promise<void> => {
  const quotedStatusId = getQuoteTargetId(note)
  if (!quotedStatusId) return

  const existingEdge = await database.getStatusQuote({ statusId: note.id })
  if (!existingEdge || existingEdge.state !== 'pending') return
  if (existingEdge.quotedStatusId !== quotedStatusId) return

  const quotedStatus = await resolveInboundQuotedStatus({
    database,
    note,
    // The edge's own stored target, never the id off the Update payload — the
    // guard above proves they match, and this is the one that cannot be moved.
    quotedStatusId: existingEdge.quotedStatusId,
    storeNote
  })
  await persistInboundQuoteEdge({
    database,
    note,
    actorId,
    quotedStatus,
    quotedStatusId
  })
}
