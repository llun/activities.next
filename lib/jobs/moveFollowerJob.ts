import { z } from 'zod'

import { follow } from '@/lib/activities'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import {
  MOVE_FOLLOWER_JOB_NAME,
  SEND_UNDO_FOLLOW_JOB_NAME
} from '@/lib/jobs/names'
import { resolveActorEmailBrand } from '@/lib/services/email/sender'
import { buildFollowEmail } from '@/lib/services/email/templates/follow'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { followGroupKey } from '@/lib/services/notifications/followGrouping'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { JobHandle } from '@/lib/services/queue/type'
import { NotificationType } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { actorIdsMatch, normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { withSpan } from '@/lib/utils/trace'

const JobData = z.object({
  followId: z.string(),
  targetActorId: z.string()
})

// One job per accepted local follower of a moved account, published by
// MoveActorJob once the move is verified. The id is derived from the origin
// follow and the target. Cloud Tasks and NoQueue do not dedupe by id, so the
// job protects itself (see getMoveFollowId) and every step is idempotent.
export const getMoveFollowerJobId = (followId: string, targetActorId: string) =>
  getHashFromString(`${followId}/move/${targetActorId}`)

// The id of the follow this job creates for one origin follow and one target,
// formatted as a UUID like every follow id. Only a row with this id is the
// job's own: it lets a retry, or a second delivery of the job, find what an
// earlier run made and never insert a second row (createFollow ignores a
// conflict on the primary key).
export const getMoveFollowId = (followId: string, targetActorId: string) => {
  const hex = getHashFromString(`${followId}/move/${targetActorId}`)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-')
}

// Deterministic, so a republish after a crash is the same job.
export const getMoveUndoJobId = (followId: string) =>
  getHashFromString(`${followId}/undo`)

const isActive = (status: FollowStatus) =>
  status === FollowStatus.enum.Accepted ||
  status === FollowStatus.enum.Requested

// Mastodon's MoveWorker#rewrite_follows! for one follower (UnfollowFollowWorker
// and FollowMigrationService): follow the new account with the same options,
// add the target to the lists, then drop the old follow (which also takes the
// origin out of the lists). Every step re-reads its state, so a
// run that was killed anywhere resumes on retry.
//
// Only a follow with the job's own id (getMoveFollowId) is this job's leftover.
// Any other follow of the target, Requested or Accepted, is the user's own:
// like FollowMigrationService, only the options are copied and the origin
// follow is kept. Lists: the target is added and the origin kept in that case
// (the origin follow stays); when the follow moves, the origin is replaced by
// the target in each list.
export const moveFollowerJob: JobHandle = createJobHandle(
  MOVE_FOLLOWER_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'moveFollower', {}, async (span) => {
      const parsed = JobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed move follower job data'))
        return
      }
      const targetId = normalizeActorId(parsed.data.targetActorId)
      const oldFollow = await database.getFollowFromId({
        followId: parsed.data.followId
      })
      // Already unfollowed, or never accepted: nothing to do. An origin follow
      // that is already Undo may be a run that died before it queued the Undo.
      if (
        !targetId ||
        !oldFollow ||
        (oldFollow.status !== FollowStatus.enum.Accepted &&
          oldFollow.status !== FollowStatus.enum.Undo)
      ) {
        return
      }
      span.setAttribute('followId', oldFollow.id)
      span.setAttribute('actorId', oldFollow.actorId)

      const ownFollowId = getMoveFollowId(oldFollow.id, targetId)
      const own = await database.getFollowFromId({ followId: ownFollowId })

      const publishUndo = () =>
        getQueue().publish({
          id: getMoveUndoJobId(oldFollow.id),
          name: SEND_UNDO_FOLLOW_JOB_NAME,
          data: { actorId: oldFollow.actorId, follow: oldFollow }
        })

      if (oldFollow.status === FollowStatus.enum.Undo) {
        // The previous run flipped the origin follow but may have died before
        // the Undo reached the queue. A follow row with this job's own id,
        // whatever its status since, shows this job most likely did the flip
        // (it only flips after creating that row). A manual unfollow in between
        // can also lead here; the result is a harmless duplicate Undo. This
        // check comes before the
        // `movedTo` check: a profile refresh may have cleared `movedTo` after
        // the flip. The lists were finished before the flip (the flip itself
        // removed the origin from them), so only the Undo is left. The job id
        // is fixed, so this is safe to repeat; SendUndoFollowJob checks the
        // state itself.
        if (own) await publishUndo()
        return
      }

      // The Move job records `movedTo` once it has verified the target; do not
      // rewire towards anything else.
      const origin = await database.getActorFromId({
        id: oldFollow.targetActorId
      })
      if (
        !origin ||
        origin.privateKey ||
        !origin.movedTo ||
        !actorIdsMatch(origin.movedTo, targetId)
      ) {
        return
      }

      const follower = await database.getActorFromId({ id: oldFollow.actorId })
      // Only accounts this server hosts are rewired; a follower row of a remote
      // actor is that server's business.
      if (!follower?.privateKey) return

      const target = await database.getActorFromId({ id: targetId })
      if (!target) return
      if (actorIdsMatch(follower.id, target.id)) return

      const isLocalTarget = Boolean(target.privateKey)

      // The target can change between the fan-out and this job: check it again
      // as MoveActorJob does, and leave the origin follow if it is unavailable.
      const states = await database.getModerationStatesForActors({
        actorIds: [target.id]
      })
      if (
        states.get(target.id)?.suspendedAt ||
        target.deletionStatus ||
        target.movedTo ||
        !(await canFederateWithDomain(database, target.id))
      ) {
        span.setAttribute('targetUnavailable', true)
        return
      }

      if (
        (await database.isEitherBlocking({
          actorIdA: follower.id,
          actorIdB: target.id
        })) ||
        (await database.isDomainBlockedByActor({
          actorId: follower.id,
          domain: target.domain
        }))
      ) {
        // Mastodon's FollowService refuses a blocked pair or a blocked domain,
        // and the origin follow stays as it was.
        return
      }

      // This job's own row that was ended (rejected, unfollowed): leave it.
      if (own && !isActive(own.status)) return

      // Adds the target to every list that holds the origin. The origin itself
      // leaves the lists when its follow is marked Undo (updateFollowStatus
      // drops the memberships of an ended follow in the same transaction), so
      // it is never removed here: a follower who keeps an Accepted origin
      // follow never loses the origin from a list.
      const addTargetToLists = async () => {
        const lists = await database.getListsWithAccount({
          actorId: follower.id,
          targetActorId: origin.id
        })
        for (const list of lists) {
          await database.addListAccounts({
            listId: list.id,
            actorId: follower.id,
            targetActorIds: [target.id],
            requireFollowOrRequest: true
          })
        }
      }

      const keepOrigin = async (existing: { id: string }) => {
        // FollowMigrationService#change_follow_options!: the follower already
        // follows (or asked to follow) the target themselves, so only the
        // options move. `undefined` leaves an existing language filter alone.
        // The target joins the lists that hold the origin; the origin stays,
        // because its follow does.
        await database.updateFollowPreferences({
          actorId: follower.id,
          targetActorId: target.id,
          reblogs: oldFollow.reblogs,
          notify: oldFollow.notify,
          languages: oldFollow.languages ?? undefined
        })
        await addTargetToLists()
        span.setAttribute('keptOriginFollow', existing.id)
      }

      const send = async (followId: string) => {
        const signingActor = await getFederationSigningActor(database)
        const sent = await follow(followId, follower, target.id, signingActor)
        if (!sent) throw new Error('Follow of the new account was not sent')
      }

      let mine = own
      if (!mine) {
        const existing = await database.getAcceptedOrRequestedFollow({
          actorId: follower.id,
          targetActorId: target.id
        })
        if (existing) return keepOrigin(existing)

        const created = await database.createFollow({
          id: ownFollowId,
          actorId: follower.id,
          targetActorId: target.id,
          status: isLocalTarget
            ? FollowStatus.enum.Accepted
            : FollowStatus.enum.Requested,
          inbox: `${follower.id}/inbox`,
          sharedInbox: `https://${follower.domain}/inbox`,
          reblogs: oldFollow.reblogs,
          notify: oldFollow.notify,
          languages: oldFollow.languages
        })
        // The user followed the target in between: theirs, not ours.
        if (created.id !== ownFollowId) return keepOrigin(created)
        mine = created

        if (isLocalTarget) {
          const followNotification = await createNotificationWithPolicy(
            database,
            {
              actorId: target.id,
              type: NotificationType.enum.follow,
              sourceActorId: follower.id,
              followId: created.id,
              groupKey: followGroupKey(Date.now())
            }
          )
          if (followNotification && !followNotification.filtered) {
            sendNotificationAlerts({
              database,
              actorId: target.id,
              sourceActorId: follower.id,
              sourceActor: follower,
              events: [
                {
                  type: NotificationType.enum.follow,
                  notificationId: followNotification.id,
                  emailContent: target.account
                    ? {
                        recipientEmail: target.account.email,
                        ...buildFollowEmail({
                          recipient: target,
                          brand: await resolveActorEmailBrand(database, target),
                          actor: follower
                        })
                      }
                    : undefined
                }
              ]
            })
          }
        }
      }
      // The row is the job's own but was ended (rejected, unfollowed) before
      // this run saw it: leave it, and leave the origin follow.
      if (!isActive(mine.status)) return

      // A failed send keeps the Requested row. The retry finds it by id and
      // sends the same row again (as Mastodon does), so a late Accept for it
      // is never one of two follows. For a local target, no remote activity is
      // sent; if the row was somehow left as Requested, transition it to Accepted.
      if (mine.status === FollowStatus.enum.Requested) {
        if (isLocalTarget) {
          await database.updateFollowStatus({
            followId: mine.id,
            status: FollowStatus.enum.Accepted
          })
        } else {
          await send(mine.id)
        }
      }

      // Order: add the target to the lists, flip the origin follow to Undo (this
      // also drops the origin from the lists, atomically), then queue the Undo.
      // SendUndoFollowJob does nothing unless the stored follow is already Undo
      // (and NoQueue runs it inline), so the flip must come first. A crash
      // after the lists step leaves the origin Accepted and the retry repeats
      // the idempotent steps; a crash after the flip leaves Undo with the lists
      // already done, and the retry only republishes the Undo (same job id).
      await addTargetToLists()
      await database.updateFollowStatus({
        followId: oldFollow.id,
        status: FollowStatus.enum.Undo
      })
      await publishUndo()
    })
  }
)
