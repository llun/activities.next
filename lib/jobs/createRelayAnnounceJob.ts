import { z } from 'zod'

import { getNote } from '@/lib/activities'
import { getConfig } from '@/lib/config'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME, RELAY_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { Status } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

// Relays forward third-party posts as a MINIMAL Announce. The common
// Announce-style relays (Pleroma `relay`, barkshark ActivityRelay) send only
// `{ @context, id, type, actor, object }` — no `published`, often no `cc` — so
// the strict AS `Announce` schema (which requires published/to/cc) would reject
// them and drop every relayed post. Model only the fields this job consumes and
// stay liberal in what we accept (AGENTS.md).
const RelayAnnounce = z
  .object({
    id: z.string(),
    type: z.literal('Announce'),
    actor: z.string(),
    object: z.union([z.string(), z.object({ id: z.string() }).passthrough()])
  })
  .passthrough()

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

// The Federated timeline is a public surface (the public API serves it
// unauthenticated). Relays can forward whatever their members emit, so we must
// independently confirm the re-fetched note is addressed to the public
// collection before publishing it — never trust the relay's framing.
const isPublicStatus = (status: Status): boolean =>
  [...status.to, ...status.cc].some(
    (recipient) =>
      recipient === ACTIVITY_STREAM_PUBLIC ||
      recipient === ACTIVITY_STREAM_PUBLIC_COMPACT
  )

// Ingests a public status forwarded by an accepted relay's Announce into the
// Federated timeline. The wrapped note is always re-fetched from its origin
// (the authenticity anchor — we never trust the relay's framing of third-party
// content), stored as a normal remote status, then appended to
// `federated_timeline`. Unlike a real boost this never creates a relay-attributed
// Announce row. Our own posts echoed back through a relay are skipped.
export const createRelayAnnounceJob: JobHandle = createJobHandle(
  RELAY_ANNOUNCE_JOB_NAME,
  async (database, message) => {
    const parsed = RelayAnnounce.safeParse(message.data)
    if (!parsed.success) return
    const objectId = getAnnouncedObjectId(parsed.data.object)
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
      // Look the stored status up by the note's canonical id — a remote server
      // may canonicalize the requested object id (trailing slash, protocol,
      // redirect), and createNoteJob persists it under note.id.
      status = await database.getStatus({
        statusId: note.id,
        withReplies: false
      })
    }
    if (!status) return
    // Defensive: never federate a local-authored status (self-echo guard #2).
    if (isLocalUrl(status.actorId, host)) return
    // Never expose a non-public (followers-only/direct) note on the public
    // Federated timeline, even if a relay forwarded it.
    if (!isPublicStatus(status)) return

    await database.addStatusToFederatedTimeline({
      statusId: status.id,
      statusActorId: status.actorId
    })
  }
)
