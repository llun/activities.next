import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getActorCollections } from '@/lib/activities/getActorCollections'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import {
  canActorReadStatus,
  resolveActorStatusesAudience
} from '@/lib/services/statusAccess'
import { mainTimelineRule } from '@/lib/services/timelines/main'
import { ENTITY_TYPE_NOTE, ENTITY_TYPE_QUESTION } from '@/lib/types/activitypub'
import { CreateAction } from '@/lib/types/activitypub/activities'
import { Actor } from '@/lib/types/domain/actor'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { isDirectStatus } from '@/lib/utils/directStatus'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { isRecord } from '@/lib/utils/typeGuards'

import { createJobHandle } from './createJobHandle'
import { createNoteJob } from './createNoteJob'
import { createPollJob } from './createPollJob'
import {
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  FOLLOW_TIMELINE_BACKFILL_JOB_NAME
} from './names'

// One Mastodon outbox page is 20 items; the slice also bounds a server that
// inlines an oversized first page, and the merge below reuses the same cap.
// Only the first page is ever fetched — this is a home-timeline nicety on
// follow accept, not an archive import — and under the in-process NoQueue the
// cap bounds the inline work the accept path runs.
const BACKFILL_MAX_STATUSES = 20

// The spellings the Public collection arrives under after compaction, matching
// fetchRemoteStatusJob's isPublic check.
const PUBLIC_STREAMS: string[] = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT,
  'Public'
]

// Merge the followed actor's most recent STORED statuses into this follower's
// home timeline (Mastodon's MergeWorker equivalent, no network). Idempotent:
// createTimelineStatus skips existing rows, and rows are keyed on the status's
// own createdAt so merged posts interleave chronologically.
const mergeStoredStatusesIntoFollowerTimeline = async (
  database: Database,
  follower: Actor,
  targetActor: Actor
) => {
  // Never call getActorStatuses without visibility arguments (it fails open —
  // AGENTS.md → Who May See an Actor's Statuses). The resolver answers what
  // THIS follower may see; the follow is already Accepted, so followers-only
  // posts are legitimately in scope, mirroring the profile page.
  const audience = await resolveActorStatusesAudience({
    database,
    targetActor,
    currentActor: follower
  })
  const statuses = await database.getActorStatuses({
    actorId: targetActor.id,
    limit: BACKFILL_MAX_STATUSES,
    publicOnly: audience.publicOnly,
    visibleToActorId: audience.visibleToActorId,
    includeFollowersOnly: audience.includeFollowersOnly,
    followersAudience: audience.followersAudience
  })

  for (const status of statuses) {
    try {
      // Home timeline only — a direct message already reached the DIRECT
      // timeline through creation-time fan-out.
      if (isDirectStatus(status)) continue
      // The SQL scope is necessary but not sufficient (AGENTS.md): it cannot
      // see through a boost, so pair it with canActorReadStatus — this drops
      // e.g. the target's public Announce of a third party's followers-only
      // post this follower cannot read.
      if (
        !(await canActorReadStatus({
          database,
          status,
          currentActor: follower
        }))
      ) {
        continue
      }
      // The same per-follower rule creation-time fan-out applies: admits the
      // target's top-level posts and boosts (respecting the follow's reblogs
      // preference), drops replies to authors this follower doesn't follow.
      const timeline = await mainTimelineRule({
        database,
        currentActor: follower,
        status
      })
      if (!timeline) continue
      await database.createTimelineStatus({
        actorId: follower.id,
        status,
        timeline
      })
    } catch (error) {
      logger.warn({
        err: toLoggableError(error),
        message: 'Failed to merge stored status into follower timeline',
        statusId: status.id,
        followerActorId: follower.id
      })
    }
  }
}

// After a follow is accepted, populate the follower's home timeline: fetch the
// followed actor's recent outbox when this instance has never stored a status
// for them (first discovery), then merge their stored statuses into this
// follower's timeline. Persistence during backfill goes through the real
// createNoteJob/createPollJob handlers — the same path live federation uses —
// so dedupe, attachments, tags, link previews and addStatusToTimelines fan-out
// behave exactly as if the posts had arrived over federation. Best-effort
// throughout: a failure here must never affect the follow itself.
export const followTimelineBackfillJob = createJobHandle(
  FOLLOW_TIMELINE_BACKFILL_JOB_NAME,
  async (database, message) => {
    const parsed = z
      .object({ actorId: z.string(), targetActorId: z.string() })
      .safeParse(message.data)
    if (!parsed.success) return
    const { actorId, targetActorId } = parsed.data

    const follower = await database.getActorFromId({ id: actorId })
    // Only a local follower has a home timeline here.
    if (!follower?.privateKey) return

    let targetActor = await database.getActorFromId({ id: targetActorId })
    const isLocalTarget = Boolean(targetActor?.privateKey)

    // A blocked domain gets neither fetched nor surfaced.
    if (
      !isLocalTarget &&
      !(await canFederateWithDomain(database, targetActorId))
    ) {
      return
    }

    const storedCount = await database.getActorStatusesCount({
      actorId: targetActorId
    })

    if (!isLocalTarget && storedCount === 0) {
      // BACKFILL branch: first discovery of this actor — fetch their outbox.
      const signingActor = await getFederationSigningActor(database)
      const recordedActor = await recordActorIfNeeded({
        actorId: targetActorId,
        database,
        signingActor
      })
      if (recordedActor) targetActor = recordedActor
      if (!targetActor || targetActor.privateKey) return

      const person = await getActorPerson({
        actorId: targetActorId,
        signingActor
      })
      if (person) {
        const collection = await getActorCollections({
          person,
          field: 'outbox',
          signingActor
        })
        const items: unknown[] = collection?.page?.orderedItems ?? []

        // Keep the newest BACKFILL_MAX_STATUSES, then process oldest-first so
        // a self-thread reply finds its already-stored parent when
        // mainTimelineRule runs (the rule drops a reply whose parent status is
        // missing).
        for (const item of items.slice(0, BACKFILL_MAX_STATUSES).reverse()) {
          // Mastodon-family outbox pages embed the activity objects; an
          // id-only item would cost a fetch per item and is skipped, matching
          // getActorPosts.
          if (!isRecord(item)) continue
          try {
            // Canonicalise the untrusted document before reading any AP terms
            // — mandatory for every new entry point parsing remote AP objects
            // (AGENTS.md → ActivityPub & JSON-LD).
            const activity = await compactActivityPub(item)
            // Announces are deliberately skipped: storing a boost requires a
            // verified re-fetch of the third-party original and pulls in
            // actors the user never followed.
            if (!isRecord(activity) || activity.type !== CreateAction) continue
            const object = activity.object
            if (!isRecord(object) || typeof object.id !== 'string') continue

            // A Create(Note) shaped like a poll vote (inReplyTo + name, no
            // content) is routed away by the shared inbox and has no place in
            // a timeline backfill.
            if (
              object.type === ENTITY_TYPE_NOTE &&
              object.inReplyTo &&
              object.name &&
              !object.content
            ) {
              continue
            }

            // Public and unlisted posts only (Public in the note's to or cc)
            // — the privacy line Mastodon's backfill PR #34597 draws: a
            // followers-only post written before the follow existed was never
            // addressed to this follower.
            const noteRecipients = [object.to, object.cc]
              .flat()
              .filter((value): value is string => typeof value === 'string')
            if (
              !noteRecipients.some((value) => PUBLIC_STREAMS.includes(value))
            ) {
              continue
            }

            // Same routing as the shared inbox's getJobMessage: Question →
            // poll, everything else → note (createNoteJob's own validation
            // drops unsupported shapes). verifiedSenderActorId pins
            // attributedTo to the followed actor, so a hostile outbox cannot
            // plant notes forged as a third party. skipQuoteResolution keeps
            // the documented single-hop quote bound at zero during backfill;
            // both flags require this direct in-process call (the
            // resolveInboundQuotedStatus.storeNote pattern), never a queue
            // publish.
            const jobMessage = {
              id: getHashFromString(object.id),
              name:
                object.type === ENTITY_TYPE_QUESTION
                  ? CREATE_POLL_JOB_NAME
                  : CREATE_NOTE_JOB_NAME,
              data: object,
              verifiedSenderActorId: targetActorId,
              skipQuoteResolution: true
            }
            if (object.type === ENTITY_TYPE_QUESTION) {
              await createPollJob(database, jobMessage)
            } else {
              await createNoteJob(database, jobMessage)
            }
          } catch (error) {
            logger.warn({
              err: toLoggableError(error),
              message: 'Failed to backfill a status for followed actor',
              targetActorId
            })
          }
        }
      }
    }

    // MERGE (always): covers the actor-already-known case outright, and after
    // a backfill it deterministically guarantees THIS follower's timeline rows
    // even when a concurrent job stored a note first (whose fan-out this
    // follower may have missed).
    if (targetActor) {
      await mergeStoredStatusesIntoFollowerTimeline(
        database,
        follower,
        targetActor
      )
    }
  }
)
