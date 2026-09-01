import { z } from 'zod'

import { getNote } from '@/lib/activities'
import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { getConfig } from '@/lib/config'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { ENTITY_TYPE_QUESTION, Tombstone } from '@/lib/types/activitypub'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { request } from '@/lib/utils/request'
import { withSpan } from '@/lib/utils/trace'

import { createJobHandle } from './createJobHandle'
import { dispatchCreateNoteOrPollJob } from './dispatchCreateNoteOrPollJob'
import {
  PROCESS_FORWARDED_ACTIVITY_JOB_NAME,
  UPDATE_NOTE_JOB_NAME,
  UPDATE_POLL_JOB_NAME
} from './names'
import { updateNoteJob } from './updateNoteJob'
import { updatePollJob } from './updatePollJob'

// A FORWARDED activity (AP §7.1.2 inbox forwarding): delivered by a server
// whose HTTP signature verified as some OTHER actor than the activity's
// `actor` — e.g. Mastodon fanning a reply's Create/Delete out to the thread
// owner's followers, signed with the thread owner's key. The payload's
// authorship is unverified, so this job trusts NOTHING from it except the
// object-id pointer: authenticity comes from re-fetching the object from its
// origin, the same doctrine as createRelayAnnounceJob. The message carries no
// verifiedSenderActorId by contract — the signer is the forwarder, not the
// author, and downstream jobs must not be told otherwise.
const ForwardedActivity = z
  .object({
    id: z.string(),
    type: z.enum(['Create', 'Update', 'Delete']),
    actor: z.string(),
    object: z.union([z.string(), z.object({ id: z.string() }).passthrough()])
  })
  .passthrough()

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const getObjectId = (object: string | { id: string }): string =>
  typeof object === 'string' ? object : object.id

const sameHost = (first: string, second: string): boolean => {
  try {
    return new URL(first).host === new URL(second).host
  } catch {
    return false
  }
}

const isTombstoneBody = async (body: string): Promise<boolean> => {
  try {
    const compacted = await compactActivityPub(JSON.parse(body))
    return Tombstone.safeParse(compacted).success
  } catch {
    return false
  }
}

export const processForwardedActivityJob = createJobHandle(
  PROCESS_FORWARDED_ACTIVITY_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'processForwardedActivity', {}, async (span) => {
      const parsed = ForwardedActivity.safeParse(message.data)
      if (!parsed.success) {
        span.setAttribute('outcome', 'malformed')
        return
      }
      const activity = parsed.data
      span.setAttribute('activityId', activity.id)
      span.setAttribute('activityType', activity.type)

      const objectId = getObjectId(activity.object)
      if (!isHttpUrl(objectId) || !isHttpUrl(activity.actor)) {
        span.setAttribute('outcome', 'malformed')
        return
      }
      // The pointer must live on the claimed author's own origin: that is what
      // makes the re-fetch authoritative for THIS activity, and it stops a
      // forwarder from steering this instance into fetching arbitrary hosts.
      if (!sameHost(objectId, activity.actor)) {
        span.setAttribute('outcome', 'cross_origin_object')
        return
      }
      const { host } = getConfig()
      if (new URL(objectId).host === host) {
        span.setAttribute('outcome', 'local_object')
        return
      }
      if (!(await canFederateWithDomain(database, activity.actor))) {
        span.setAttribute('outcome', 'domain_not_federatable')
        return
      }
      const signingActor = await getFederationSigningActor(database)
      // Without the instance signing actor we cannot make the signed origin
      // fetch most servers require, so skip rather than fetch unsigned.
      if (!signingActor) {
        span.setAttribute('outcome', 'no_signing_actor')
        return
      }

      if (activity.type === 'Delete') {
        // An actor self-delete is delivered directly by its origin (signer ===
        // actor) and never arrives forwarded; the guard's unknown-actor fast
        // path handles the unknown case. Never treat an actor URL as a status.
        if (normalizeActorId(objectId) === normalizeActorId(activity.actor)) {
          span.setAttribute('outcome', 'actor_delete_skipped')
          return
        }
        let statusCode: number
        let body: string
        try {
          ;({ statusCode, body } = await request({
            url: objectId,
            headers: activityPubRequestHeaders({ url: objectId, signingActor })
          }))
        } catch {
          // A network failure is AMBIGUOUS and must never confirm a delete.
          span.setAttribute('outcome', 'origin_unreachable')
          return
        }
        const confirmed =
          statusCode === 404 ||
          statusCode === 410 ||
          (statusCode === 200 && (await isTombstoneBody(body)))
        if (!confirmed) {
          span.setAttribute('outcome', 'delete_unconfirmed')
          span.setAttribute('originStatusCode', statusCode)
          return
        }
        // Origin no longer serves the object, so removing our copy is safe.
        // Still scope to the claimed author: a forged pointer at someone
        // else's (coincidentally 404ing) id must not delete a status the
        // claimed author does not own.
        await database.deleteStatus({
          statusId: objectId,
          actorId: normalizeActorId(activity.actor) ?? undefined
        })
        span.setAttribute('outcome', 'delete_confirmed')
        return
      }

      // Create / Update: the authentic content is the note as ORIGIN serves
      // it. The forwarded payload's embedded object is discarded entirely.
      if (activity.type === 'Create') {
        const existing = await database.getStatus({
          statusId: objectId,
          withReplies: false
        })
        if (existing) {
          span.setAttribute('outcome', 'already_stored')
          return
        }
      }
      const note = await getNote({ statusId: objectId, signingActor })
      if (!note) {
        span.setAttribute('outcome', 'origin_fetch_failed')
        return
      }
      // The fetched note must be attributed to the actor the forwarded
      // activity named — otherwise the envelope lied about authorship.
      if (
        normalizeActorId(note.attributedTo) !== normalizeActorId(activity.actor)
      ) {
        span.setAttribute('outcome', 'attribution_mismatch')
        return
      }
      // Hand the FETCHED note to the normal pipeline, deliberately without a
      // verifiedSenderActorId: authenticity came from the origin fetch, so the
      // forwarder's signature does not have to match the note's author —
      // exactly how createRelayAnnounceJob calls createNoteJob. createNoteJob
      // and createPollJob still enforce the author's own federation policy itself.
      const stored = await database.getStatus({
        statusId: note.id,
        withReplies: false
      })
      if (activity.type === 'Update' && stored) {
        if (note.type === ENTITY_TYPE_QUESTION) {
          await updatePollJob(database, {
            id: note.id,
            name: UPDATE_POLL_JOB_NAME,
            data: note
          })
        } else {
          await updateNoteJob(database, {
            id: note.id,
            name: UPDATE_NOTE_JOB_NAME,
            data: note
          })
        }
        span.setAttribute('outcome', 'update_applied')
        return
      }
      await dispatchCreateNoteOrPollJob(database, note)
      span.setAttribute('outcome', 'create_stored')
    })
  }
)
