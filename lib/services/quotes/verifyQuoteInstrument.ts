import { getNote } from '@/lib/activities'
import { BaseNote, getQuoteTargetId } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

type VerifyQuoteInstrumentParams = {
  database: Database
  // The quoting note id named by the QuoteRequest `instrument`.
  instrumentId: string
  // The HTTP-signature-verified requester (the QuoteRequest `actor`).
  requesterId: string
  // The status the QuoteRequest asks to quote (the QuoteRequest `object`).
  quotedStatusId: string
}

/**
 * Prove a QuoteRequest's `instrument` really is the requester's own note that
 * quotes our status. An HTTP signature only proves who *sent* the request, not
 * who authored the instrument note, so on a multi-user instance a verified actor
 * could otherwise name a co-resident's note as the instrument. We dereference
 * the canonical note by id (its embedded `attributedTo` is self-attested and
 * untrustworthy), signing with the headless instance actor, and require that:
 *   - the fetched note's id equals the requested instrument id (no redirect to a
 *     different, e.g. co-resident, note),
 *   - its author is the requester, and
 *   - it actually quotes the target status.
 * Any fetch/parse failure yields false so the request is never auto-approved.
 */
export const verifyQuoteInstrument = async ({
  database,
  instrumentId,
  requesterId,
  quotedStatusId
}: VerifyQuoteInstrumentParams): Promise<boolean> => {
  try {
    const signingActor = await getFederationSigningActor(database)
    const note = await getNote({ statusId: instrumentId, signingActor })
    if (!note) return false

    // A redirect/alias must not let a different note stand in for the named id.
    if (note.id !== instrumentId) return false

    const author =
      typeof note.attributedTo === 'string' ? note.attributedTo : null
    if (!author) return false
    if (normalizeActorId(author) !== normalizeActorId(requesterId)) return false

    // Tie the approval to the specific quote intent: the instrument must be the
    // note that actually quotes our status.
    if (getQuoteTargetId(note as BaseNote) !== quotedStatusId) return false

    return true
  } catch (error) {
    logger.warn({
      message: 'Failed to verify quote instrument',
      instrumentId,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}
