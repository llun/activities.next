import {
  assertActorCanFederate,
  recordActorIfNeeded
} from '@/lib/actions/utils'
import { getNote } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { createPollJob } from '@/lib/jobs/createPollJob'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME
} from '@/lib/jobs/names'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { JobHandle } from '@/lib/services/queue/type'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Announce, ENTITY_TYPE_QUESTION } from '@/lib/types/activitypub'
import {
  normalizeActivityPubAnnounce,
  normalizeActivityPubUri,
  toRecipientArray
} from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

export const createAnnounceJob: JobHandle = createJobHandle(
  CREATE_ANNOUNCE_JOB_NAME,
  async (database, message) => {
    const parseResult = Announce.safeParse(
      normalizeActivityPubAnnounce(message.data)
    )
    if (!parseResult.success) {
      return
    }
    const status = parseResult.data

    let object: string
    if (typeof status.object === 'string') {
      object = status.object
    } else if (
      status.object &&
      typeof (status.object as { id?: unknown }).id === 'string'
    ) {
      object = (status.object as { id: string }).id
    } else {
      return
    }

    await assertActorCanFederate({ actorId: status.actor, database })
    const signingActor = await getFederationSigningActor(database)

    let targetStatus = await database.getStatus({
      statusId: object,
      withReplies: false
    })
    if (!targetStatus) {
      const boostedStatus = await getNote({ statusId: object, signingActor })
      if (!boostedStatus) {
        return
      }
      // `object` is the id the Announce itself named; `boostedStatus.id` is
      // SELF-REPORTED by whatever server answered that URL, and the two must
      // agree. createNoteJob/createPollJob persist under — and silently no-op
      // on an already-stored — the FETCHED id, so a document claiming an
      // unrelated stored status's id stores nothing and then hands that status
      // to `createAnnounce` below as `originalStatusId`. The result is a forged
      // boost of a post the announcer never saw, and because
      // `addStatusToTimelines` fans an Announce out on the ANNOUNCE's own
      // recipients, a local followers-only or direct status can be surfaced to
      // whoever the attacker addresses. Drop the Announce rather than
      // substituting a status we were never pointed at. Both sides are
      // normalized so a benign case/serialization difference still resolves.
      if (
        normalizeActivityPubUri(boostedStatus.id) !==
        normalizeActivityPubUri(object)
      ) {
        logger.warn({
          message:
            'Ignoring an announce whose boosted status id does not match the announced object',
          announceId: status.id,
          announcedObjectId: object,
          fetchedStatusId: boostedStatus.id
        })
        return
      }
      if (boostedStatus.type === ENTITY_TYPE_QUESTION) {
        await createPollJob(database, {
          id: boostedStatus.id,
          name: CREATE_POLL_JOB_NAME,
          data: boostedStatus
        })
      } else {
        await createNoteJob(database, {
          id: boostedStatus.id,
          name: CREATE_NOTE_JOB_NAME,
          data: boostedStatus
        })
      }
      targetStatus =
        (await database.getStatus({
          statusId: object,
          withReplies: false
        })) ??
        // Reachable only when `object` and the fetched id differ by the benign
        // normalization the guard above admits — an explicit default port,
        // percent-encoding, or dot segments in the Announce's spelling against
        // the canonical form the origin serves. `getStatus` does not normalize,
        // and the child job stored the row under the FETCHED spelling, so the
        // `object` lookup misses it. Guarded above, this can no longer resolve
        // an unrelated status. (Host case never reaches here: the HTTP client
        // lowercases the authority before the request is made.)
        (await database.getStatus({
          statusId: boostedStatus.id,
          withReplies: false
        }))
    }
    if (!targetStatus) {
      return
    }
    const existingAnnounce = await database.getStatus({
      statusId: status.id,
      withReplies: false
    })
    if (existingAnnounce) {
      return
    }
    const [, announce] = await Promise.all([
      recordActorIfNeeded({ actorId: status.actor, database, signingActor }),
      database.createAnnounce({
        id: status.id,
        actorId: status.actor,
        to: toRecipientArray(status.to),
        cc: toRecipientArray(status.cc),
        originalStatusId: targetStatus.id
      })
    ])
    if (!announce) {
      return
    }
    await addStatusToTimelines(database, announce)
  }
)
