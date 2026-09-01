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
  isSameActivityPubOrigin,
  normalizeActivityPubAnnounce,
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
      logger.warn({
        message: 'Dropping malformed announce payload',
        job: CREATE_ANNOUNCE_JOB_NAME,
        announceId: (message.data as { id?: unknown } | null)?.id
      })
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
      // SELF-REPORTED by whatever server answered that URL. What this guard
      // closes is the CROSS-ORIGIN case: createNoteJob/createPollJob persist
      // under the FETCHED id, so without it a document claiming an id on
      // someone else's host either plants attacker content in that host's id
      // space, or — when a status is already stored there — no-ops and hands
      // that status to `createAnnounce` below as `originalStatusId`.
      //
      // It does NOT make an Announce's target safe in general: a boost of an
      // ALREADY-STORED status never reaches here at all, because `getStatus`
      // above resolves it and skips this whole branch. `createAnnounce` checks
      // only that the original exists — no audience check — so a remote actor
      // can still boost a local followers-only or direct status by naming its
      // id directly. `createRelayAnnounceJob` gates that with `isPublicStatus`;
      // this job has no equivalent. See AGENTS.md, "A Fetched Document's Own
      // `id` Is Not Evidence" — it is tracked there as open, and is a
      // pre-existing hole rather than one this guard was ever positioned to
      // close.
      //
      // The boundary is the ORIGIN, not the exact id — the same rule the quote
      // and forwarded-activity paths apply, and the tightest one that is still
      // correct. An exact match would break real federation: a server may
      // canonicalise a URL within its own origin, and this instance's own
      // `proxy.ts` does exactly that (an Announce naming `/@user/<id>` is
      // answered with a document whose id is `/users/<user>/statuses/<n>`).
      // `createRelayAnnounceJob` records the same fact for the same fetch.
      // Cross-origin is the whole attack, because a server can already serve
      // whatever it likes at any id it owns.
      if (!isSameActivityPubOrigin(boostedStatus.id, object)) {
        logger.warn({
          message:
            'Ignoring an announce whose boosted status id is on a different origin than the announced object',
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
        // Reachable whenever the Announce named a same-origin alias of the
        // status rather than its canonical id — a permalink, an explicit
        // default port, a redirect the fetch followed. `getStatus` does not
        // normalize and the child job stored the row under the FETCHED
        // spelling, so the `object` lookup misses a row that was just written.
        // This is the arm #1694 added; the origin guard above is what keeps it
        // from resolving a status on someone else's host.
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
