import { getNote } from '@/lib/activities'
import { getConfig } from '@/lib/config'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME, RELAY_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { Announce } from '@/lib/types/activitypub'
import { normalizeActivityPubAnnounce } from '@/lib/utils/activitypub'

const isLocalUrl = (value: string, host: string): boolean => {
  try {
    return new URL(value).host === host
  } catch {
    return false
  }
}

const getAnnouncedObjectId = (object: unknown): string | null => {
  if (typeof object === 'string') return object
  if (object && typeof (object as { id?: unknown }).id === 'string') {
    return (object as { id: string }).id
  }
  return null
}

// Ingests a public status forwarded by an accepted relay's Announce into the
// Federated timeline. The wrapped note is always re-fetched from its origin
// (the authenticity anchor — we never trust the relay's framing of third-party
// content), stored as a normal remote status, then appended to
// `federated_timeline`. Unlike a real boost this never creates a relay-attributed
// Announce row. Our own posts echoed back through a relay are skipped.
export const createRelayAnnounceJob: JobHandle = createJobHandle(
  RELAY_ANNOUNCE_JOB_NAME,
  async (database, message) => {
    const announce = Announce.parse(normalizeActivityPubAnnounce(message.data))
    const objectId = getAnnouncedObjectId(announce.object)
    if (!objectId) return

    const { host } = getConfig()
    // Skip our own posts relayed back to us.
    if (isLocalUrl(objectId, host)) return

    let status = await database.getStatus({
      statusId: objectId,
      withReplies: false
    })
    if (!status) {
      const signingActor = await getFederationSigningActor(database)
      const note = await getNote({ statusId: objectId, signingActor })
      if (!note) return
      // createNoteJob enforces the note author's federation policy and persists
      // the status; called without verifiedSenderActorId so the relay's
      // signature does not have to match the note's author.
      await createNoteJob(database, {
        id: note.id,
        name: CREATE_NOTE_JOB_NAME,
        data: note
      })
      status = await database.getStatus({
        statusId: objectId,
        withReplies: false
      })
    }
    if (!status) return
    // Defensive: never federate a local-authored status (self-echo guard #2).
    if (isLocalUrl(status.actorId, host)) return

    await database.addStatusToFederatedTimeline({
      statusId: status.id,
      statusActorId: status.actorId
    })
  }
)
