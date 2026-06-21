import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { follow } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { COLLECTION_BACKFILL_MAX_POSTS } from '@/lib/services/timelines/types'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'

import { createJobHandle } from './createJobHandle'
import { INGEST_COLLECTION_MEMBER_JOB_NAME } from './names'

// Two actor ids share a host iff they live on the same instance. The instance
// actor is always local, so comparing against its host is how we tell a remote
// member (needs follow + backfill) from a local one (whose posts already fan
// into the collection feed through the normal create flow).
const isSameHost = (actorId: string, otherActorId: string): boolean => {
  try {
    return new URL(actorId).host === new URL(otherActorId).host
  } catch {
    return false
  }
}

// A remote actor was added to a collection. The instance/federation actor
// follows them (so their future posts keep arriving over federation and fan
// into the collection feed) and backfills their most recent public posts so the
// curator's (owner-projection) feed shows history immediately instead of
// starting empty. The public projection still gates on the member's featuring
// consent (members start `pending` and only `approved` members appear publicly),
// so backfilled rows surface publicly only once that consent lands — by design.
// Both steps are idempotent and best-effort: re-adding a member, or a member
// already followed for another collection, does no extra work, and a federation
// failure on one post never aborts the rest.
export const ingestCollectionMemberJob = createJobHandle(
  INGEST_COLLECTION_MEMBER_JOB_NAME,
  async (database, message) => {
    const { memberActorId } = z
      .object({ memberActorId: z.string() })
      .parse(message.data)

    const signingActor = await getFederationSigningActor(database)
    if (!signingActor) return

    // Local members need neither a follow nor a backfill: their posts already
    // fan into the collection feed when created, so this job is a no-op for them.
    if (isSameHost(memberActorId, signingActor.id)) return

    if (!(await canFederateWithDomain(database, memberActorId))) return

    // Idempotency guard: a member can belong to several collections (or be
    // re-added), but the instance actor only needs to follow + backfill them
    // once. An existing accepted/requested follow means we've already ingested
    // them, so skip both steps.
    const existingFollow = await database.getAcceptedOrRequestedFollow({
      actorId: signingActor.id,
      targetActorId: memberActorId
    })
    if (existingFollow) return

    // Record the member's actor up front so backfilled notes satisfy the
    // foreign key and fan-out can resolve the author.
    const actor = await recordActorIfNeeded({
      actorId: memberActorId,
      database,
      signingActor
    })
    if (!actor) return

    const person = await getActorPerson({
      actorId: memberActorId,
      signingActor
    })
    if (!person) return

    // Derive the inbox/sharedInbox from the signing actor's own canonical id so
    // the protocol and port match it (rather than hardcoding https), keeping
    // local/dev and custom-port deployments correct.
    const signingActorOrigin = new URL(signingActor.id).origin
    const followItem = await database.createFollow({
      actorId: signingActor.id,
      targetActorId: memberActorId,
      status: FollowStatus.enum.Requested,
      inbox: `${signingActor.id}/inbox`,
      sharedInbox: `${signingActorOrigin}/inbox`
    })
    await follow(followItem.id, signingActor, memberActorId, signingActor)

    // Backfill the most recent posts from the member's outbox. Only plain notes
    // are stored here (announces/polls carry extra structure the simple
    // createNote path can't persist); the cap bounds federation traffic and the
    // inline NoQueue latency.
    let statuses
    try {
      ;({ statuses } = await getActorPosts({ database, person, signingActor }))
    } catch (error) {
      logger.warn({
        message: 'Failed to backfill collection member posts',
        memberActorId,
        error
      })
      return
    }

    const recentNotes = statuses
      .filter(
        (status): status is StatusNote => status.type === StatusType.enum.Note
      )
      .slice(0, COLLECTION_BACKFILL_MAX_POSTS)
    if (recentNotes.length === 0) return

    // Resolve which notes are already stored in a single round-trip rather than
    // one getStatus per note, so the existence check is O(1) queries.
    const existingIds = new Set(
      (
        await database.getStatusesByIds({
          statusIds: recentNotes.map((note) => note.id)
        })
      ).map((status) => status.id)
    )

    for (const note of recentNotes) {
      if (existingIds.has(note.id)) continue
      try {
        const created = await database.createNote({
          id: note.id,
          url: note.url,
          actorId: note.actorId,
          text: note.text,
          summary: note.summary ?? '',
          to: note.to,
          cc: note.cc,
          reply: note.reply || '',
          createdAt: note.createdAt
        })
        // Fan the backfilled note into every collection whose membership
        // includes its author (the read-time projections still apply).
        await database.addStatusToCollectionTimelines({ status: created })
      } catch {
        // Ignore: a concurrent ingest may have already stored this note.
      }
    }
  }
)
