import { BaseNote } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { ENTITY_TYPE_QUESTION } from '@/lib/types/activitypub'
import {
  extractActivityPubId,
  isSameActivityPubOrigin
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

import { createNoteJob } from './createNoteJob'
import { createPollJob } from './createPollJob'
import { CREATE_NOTE_JOB_NAME, CREATE_POLL_JOB_NAME } from './names'

// Dispatch a fetched note to the right Create JOB handler: a `Question` goes to
// createPollJob, everything else to createNoteJob. This is the boost/relay/
// forward paths' shared "store this origin-fetched note" step — each re-fetches
// the note from its origin, then hands it to the pipeline in-process (no queue
// publish) under the note's own canonical id. Shared verbatim by
// createAnnounceJob, createRelayAnnounceJob and processForwardedActivityJob's
// Create branch so the three cannot drift.
//
// The Update branch and the quote-resolution callbacks are deliberately NOT
// routed through here: Update dispatches to the different updatePollJob/
// updateNoteJob pair, and the quote callbacks carry extra message fields
// (`...bound`). followTimelineBackfillJob is also left alone — it derives the
// dedup id as `getHashFromString(object.id)` and adds `verifiedSenderActorId`/
// `skipQuoteResolution`.
//
// The note's AUTHOR must share the note id's origin. All three callers dispatch
// without a `verifiedSenderActorId` — authenticity comes from the origin fetch,
// not from the sender's signature — so `actorMatchesVerifiedSender` fails open
// and nothing downstream binds `attributedTo` to anything. Each caller already
// pins `note.id` to the origin it fetched, but that only proves the origin
// vouches for the DOCUMENT: a server answering at its own id can still claim
// any author, including a local actor, and the stored row would then show on
// that actor's profile and fan out as theirs. (processForwardedActivityJob
// already binds the author through its own pointer-origin and attribution
// checks; the boost and relay paths rely on this one.) The origin can only speak for
// actors it hosts, so a cross-origin `attributedTo` is refused here, at the one
// seam all three paths share — the same binding `fetchQuoteTargetForCreate`,
// `resolveInboundQuotedStatus` and `fetchRemoteStatusJob` apply. See
// docs/mastodon-api-compatibility.md, "A Fetched Document's Own `id` Is Not
// Evidence".
//
// The raw fetched `attributedTo` is not normalized yet: an embedded actor object
// or a multi-valued array (PeerTube names the account AND the channel) survives
// JSON-LD compaction as-is. Gate the id `extractActivityPubId` picks — the same
// extraction `normalizeActivityPubContent` applies before createNoteJob stores
// the author — so the id checked here is the id that gets stored.
export const dispatchCreateNoteOrPollJob = async (
  database: Database,
  note: BaseNote
): Promise<void> => {
  const attributedTo = extractActivityPubId(note.attributedTo)
  if (!isSameActivityPubOrigin(attributedTo, note.id)) {
    logger.warn({
      message:
        'Ignoring an origin-fetched note attributed to an actor on a different origin',
      statusId: note.id,
      attributedTo
    })
    return
  }
  if (note.type === ENTITY_TYPE_QUESTION) {
    await createPollJob(database, {
      id: note.id,
      name: CREATE_POLL_JOB_NAME,
      data: note
    })
    return
  }
  await createNoteJob(database, {
    id: note.id,
    name: CREATE_NOTE_JOB_NAME,
    data: note
  })
}
