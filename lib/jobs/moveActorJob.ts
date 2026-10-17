import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { getMoveFollowerJobId } from '@/lib/jobs/moveFollowerJob'
import { MOVE_ACTOR_JOB_NAME, MOVE_FOLLOWER_JOB_NAME } from '@/lib/jobs/names'
import { actorMatchesVerifiedSender } from '@/lib/jobs/verifiedSender'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { getQueue } from '@/lib/services/queue'
import { JobHandle } from '@/lib/services/queue/type'
import { Actor } from '@/lib/types/domain/actor'
import { actorIdsMatch, normalizeActorId } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

const JobData = z.object({
  actor: z.string(),
  object: z.string(),
  target: z.string()
})

// Mastodon: `move_in_progress` expires after 7 days.
const MOVE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

const includesActorId = (aliases: string[] | undefined, actorId: string) =>
  (aliases ?? []).some((alias) => actorIdsMatch(alias, actorId))

// Re-reads the target from its own origin with a signed request (when a
// federation signing actor is configured), never taken from the Move body.
// `null` means "cannot verify". Local targets are refused before this runs.
const getTargetAliases = async (
  targetId: string,
  signingActor: Actor | undefined
): Promise<{ aliases: string[]; moved: boolean } | null> => {
  const person = await getActorPerson({ actorId: targetId, signingActor })
  if (!person || !actorIdsMatch(person.id, targetId)) return null
  return { aliases: person.alsoKnownAs ?? [], moved: Boolean(person.movedTo) }
}

// The checks Mastodon makes before it records a move: the target must be
// reachable, list the origin as an alias, and be neither suspended nor deleted.
// Returns the stored target, or null when any check fails.
const verifyTarget = async ({
  database,
  origin,
  targetId,
  signingActor,
  span
}: {
  database: Database
  origin: Actor
  targetId: string
  signingActor: Actor | undefined
  span: { setAttribute: (key: string, value: boolean) => unknown }
}): Promise<(Actor & { moved: boolean }) | null> => {
  const targetInfo = await getTargetAliases(targetId, signingActor)
  if (!targetInfo) {
    span.setAttribute('targetUnreachable', true)
    return null
  }
  if (!includesActorId(targetInfo.aliases, origin.id)) {
    span.setAttribute('aliasMismatch', true)
    return null
  }

  const target = await recordActorIfNeeded({
    actorId: targetId,
    database,
    signingActor,
    forceRefresh: true
  })
  if (!target || target.privateKey || actorIdsMatch(target.id, origin.id)) {
    return null
  }

  const states = await database.getModerationStatesForActors({
    actorIds: [target.id]
  })
  if (states.get(target.id)?.suspendedAt || target.deletionStatus) {
    span.setAttribute('targetUnavailable', true)
    return null
  }
  return { ...target, moved: targetInfo.moved }
}

// Applies an inbound `Move` (Mastodon account migration, ActivityPub::Activity
// ::Move plus MoveWorker). The inbox bound the signer to the origin account;
// here the target is re-fetched and must list the origin in `alsoKnownAs`,
// otherwise anyone could "move" an account onto a profile of their choosing.
// Like Mastodon's `move_in_progress` key, one Move per origin is processed
// every 7 days, and the claim is released when verification fails. The job
// verifies once, records `movedTo`, then publishes one MoveFollowerJob per
// accepted local follower, each with a deterministic id, so a retry or a
// redelivery of the same Move never abandons or duplicates a follower.
export const moveActorJob: JobHandle = createJobHandle(
  MOVE_ACTOR_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'moveActor', {}, async (span) => {
      const parsed = JobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed move actor job data'))
        return
      }
      const originId = normalizeActorId(parsed.data.actor)
      const targetId = normalizeActorId(parsed.data.target)
      span.setAttribute('actorId', parsed.data.actor)
      span.setAttribute('targetActorId', parsed.data.target)
      if (
        !originId ||
        !targetId ||
        originId === targetId ||
        normalizeActorId(parsed.data.object) !== originId ||
        !actorMatchesVerifiedSender(originId, message)
      ) {
        span.setAttribute('rejected', true)
        return
      }

      if (
        !(await canFederateWithDomain(database, originId)) ||
        !(await canFederateWithDomain(database, targetId))
      ) {
        return
      }

      // A local account never moves by network activity, and local accounts
      // cannot list aliases yet, so a local target can never verify either.
      const knownOrigin = await database.getActorFromId({ id: originId })
      if (knownOrigin?.privateKey) return
      const knownTarget = await database.getActorFromId({ id: targetId })
      if (knownTarget?.privateKey) {
        span.setAttribute('localTarget', true)
        return
      }
      const states = await database.getModerationStatesForActors({
        actorIds: [originId]
      })
      if (states.get(originId)?.suspendedAt) return

      const signingActor = await getFederationSigningActor(database)
      const origin =
        knownOrigin ??
        (await recordActorIfNeeded({
          actorId: originId,
          database,
          signingActor
        }))
      if (!origin || origin.privateKey) return

      // Mastodon: `move_in_progress:<account_id>`, nx, 7 days.
      const claimed = await database.claimActorMove({
        actorId: origin.id,
        activityId: message.id,
        target: targetId,
        now: Date.now(),
        windowMs: MOVE_COOLDOWN_MS
      })
      if (!claimed) {
        span.setAttribute('moveInProgress', true)
        return
      }

      let recorded = false
      try {
        // A retry of a Move this activity already verified and recorded skips
        // the verification: a target that is temporarily unreachable must not
        // leave the followers unqueued. It uses the stored target.
        const held = (await database.getActorSettings({ actorId: origin.id }))
          ?.moveProcessing
        const storedTarget =
          held?.verified &&
          held.activityId === message.id &&
          held.target === targetId &&
          origin.movedTo &&
          actorIdsMatch(origin.movedTo, targetId)
            ? await database.getActorFromId({ id: targetId })
            : undefined
        let target: (Actor & { moved: boolean }) | null
        if (storedTarget && !storedTarget.privateKey) {
          span.setAttribute('verifiedRetry', true)
          target = { ...storedTarget, moved: Boolean(storedTarget.movedTo) }
          recorded = true
        } else {
          target = await verifyTarget({
            database,
            origin,
            targetId,
            signingActor,
            span
          })
          if (!target) return

          await database.updateActor({ actorId: origin.id, movedTo: target.id })
          recorded = true
          // From here the claim is kept for the 7 days, even if a replay of
          // this Move fails verification later.
          await database.markActorMoveVerified({
            actorId: origin.id,
            activityId: message.id
          })
        }

        // Mastodon follows a moved account only if it is live: a target that
        // has itself moved on keeps the origin's `movedTo`, but no follower is
        // rewired onto it.
        if (target.moved) {
          span.setAttribute('targetMoved', true)
          return
        }

        const follows = await database.getLocalFollowersForActorId({
          targetActorId: origin.id
        })
        let failures = 0
        for (const oldFollow of follows) {
          try {
            await getQueue().publish({
              id: getMoveFollowerJobId(oldFollow.id, target.id),
              name: MOVE_FOLLOWER_JOB_NAME,
              data: { followId: oldFollow.id, targetActorId: target.id }
            })
          } catch (error) {
            failures += 1
            logger.error({
              message: 'Move: failed to queue a follower',
              actorId: oldFollow.actorId,
              originId: origin.id,
              targetActorId: target.id,
              err: toLoggableError(error)
            })
          }
        }
        // Retry: the ids are deterministic, so followers already queued are
        // not queued twice.
        if (failures > 0) {
          throw new Error(`Move: ${failures} follower(s) could not be queued`)
        }
      } finally {
        // Verification failed before anything was recorded (or threw): release
        // the claim so a correct Move, or this one's retry, is not blocked.
        if (!recorded) {
          await database.clearActorMove({
            actorId: origin.id,
            activityId: message.id
          })
        }
      }
    })
  }
)
