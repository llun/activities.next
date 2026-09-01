import { BaseNote } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { ENTITY_TYPE_QUESTION } from '@/lib/types/activitypub'

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
export const dispatchCreateNoteOrPollJob = async (
  database: Database,
  note: BaseNote
): Promise<void> => {
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
