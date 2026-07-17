import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { BaseNote, getQuoteTargetId } from '@/lib/activities/note'
import { QuoteAuthorization } from '@/lib/activities/quoteRequest'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import {
  QuoteState,
  Status,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'

type VerifyRemoteQuoteParams = {
  database: Database
  // The quoting note (already compacted at the inbox boundary).
  note: BaseNote
  // The quoting actor id (the note's attributedTo, normalized).
  actorId: string
  // The quoted status, if we already have it locally; null otherwise.
  quotedStatus: Status | null
}

// Two ActivityPub ids share authority when they are served from the same host.
// The stamp is authoritative only if the quoted author's own server hosts it, so
// a stamp fetched from (or claiming an id on) any other host is not trusted —
// this is what stops a quoter from serving a forged authorization that merely
// *names* the quoted author in `attributedTo`.
const sameAuthority = (a: string, b: string): boolean => {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

/**
 * Fetch and validate the FEP-044f QuoteAuthorization stamp. Signed with the
 * headless instance actor (every s2s fetch uses the instance signer), compacted,
 * and safe-parsed. Any failure yields null so the caller degrades to `pending`.
 */
const fetchQuoteAuthorization = async (
  database: Database,
  stampUri: string
): Promise<QuoteAuthorization | null> => {
  try {
    const signingActor = await getFederationSigningActor(database)
    const { statusCode, body } = await request({
      url: stampUri,
      headers: activityPubRequestHeaders({
        url: stampUri,
        signingActor,
        accept: 'application/activity+json'
      })
    })
    if (statusCode !== 200) return null
    const compacted = await compactActivityPub(JSON.parse(body))
    const parsed = QuoteAuthorization.safeParse(compacted)
    return parsed.success ? parsed.data : null
  } catch (error) {
    logger.warn({
      message: 'Failed to fetch quote authorization stamp',
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

/**
 * Decide the stored state of an inbound remote quote, applying the FEP-044f
 * receiver rules:
 * - quoter == quoted author (self-quote) → `accepted` (same-authority shortcut);
 * - a `quoteAuthorization` stamp that is hosted under the quoted author's own
 *   authority (both the fetched URL and the stamp's declared id) AND dereferences
 *   to a valid QuoteAuthorization whose three fields (attributedTo,
 *   interactingObject, interactionTarget) all match → `accepted`;
 * - anything else (no stamp, unknown quoted author, foreign-authority stamp,
 *   fetch/parse failure, field mismatch) → `pending` (rendered as an unapproved
 *   placeholder, never dropped).
 */
export const verifyRemoteQuote = async ({
  database,
  note,
  actorId,
  quotedStatus
}: VerifyRemoteQuoteParams): Promise<QuoteState> => {
  const quotedStatusId = getQuoteTargetId(note)
  if (!quotedStatusId) return 'pending'

  const quotedAuthorId = quotedStatus
    ? getOriginalStatus(quotedStatus).actorId
    : null

  // Same-authority shortcut: the quoted author is the quoter.
  if (quotedAuthorId && quotedAuthorId === actorId) return 'accepted'

  const stampUri = note.quoteAuthorization
  if (!stampUri) return 'pending'

  // We can only verify the stamp's `attributedTo` against a known quoted author.
  // Without the quoted status locally we cannot confirm the author, so treat the
  // quote as unapproved rather than trusting a stamp the quoter chose.
  if (!quotedAuthorId) return 'pending'

  const stamp = await fetchQuoteAuthorization(database, stampUri)
  if (!stamp) return 'pending'

  const valid =
    // The stamp must actually be hosted under the quoted author's authority —
    // both the URL we fetched and the id the document claims — otherwise a
    // quoter could serve a forged stamp naming the author in `attributedTo`.
    sameAuthority(stampUri, quotedAuthorId) &&
    sameAuthority(stamp.id, quotedAuthorId) &&
    // FEP-044f three-field match: issued by the quoted author, for this exact
    // quoting note, targeting this exact quoted status.
    stamp.attributedTo === quotedAuthorId &&
    stamp.interactingObject === note.id &&
    stamp.interactionTarget === quotedStatusId
  return valid ? 'accepted' : 'pending'
}
