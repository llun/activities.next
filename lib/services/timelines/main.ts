import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusType } from '@/lib/types/domain/status'
import { withSpan } from '@/lib/utils/trace'

import { MainTimelineRule, Timeline } from './types'

/**
 * Main timeline
 *
 * Timeline that shows in the main index when user logged in to the server
 *
 * Includes
 * - Self status
 * - Following people status
 * - Following people status that replied to another following people status
 * - Announce from following people
 * - Non-following people status that reply to self status
 *
 * Excludes
 * - Following people status that replied to non-following people status
 * - Non following people status
 * - Announce that has status already in the timeline
 * - Deleted status
 *
 */
export const mainTimelineRule: MainTimelineRule = async ({
  database,
  currentActor,
  status
}) =>
  withSpan(
    'timeline',
    'mainTimelineRule',
    {
      actorId: currentActor.id,
      statusId: status.id
    },
    async () => {
      if (status.type === StatusType.enum.Announce) {
        // The viewer's own boosts always belong in their home timeline; only
        // boosts from others are gated on the follow. A single lookup yields
        // both whether the viewer is an accepted follower of the booster and
        // their reblogs preference, so skip a boost from someone they don't
        // accept-follow, or followed with reblogs=false (matching the
        // relationship's showing_reblogs=false).
        if (status.actorId !== currentActor.id) {
          const announceFollow = await database.getAcceptedOrRequestedFollow({
            actorId: currentActor.id,
            targetActorId: status.actorId
          })
          if (
            !announceFollow ||
            announceFollow.status !== FollowStatus.enum.Accepted ||
            announceFollow.reblogs === false
          ) {
            return null
          }
        }

        const originalStatus = status.originalStatus
        const timeline = await mainTimelineRule({
          database,
          currentActor,
          status: originalStatus
        })
        if (timeline === Timeline.MAIN) return null
        return Timeline.MAIN
      }

      if (status.actorId === currentActor.id) {
        return Timeline.MAIN
      }
      const isFollowing = await database.isCurrentActorFollowing({
        currentActorId: currentActor.id,
        followingActorId: status.actorId
      })

      if (!status.reply) {
        if (isFollowing) return Timeline.MAIN
        return null
      }

      const repliedStatus = await database.getStatus({
        statusId: status.reply,
        withReplies: false
      })
      // Deleted parent status, don't show child status
      if (!repliedStatus) {
        return null
      }
      if (repliedStatus.actorId === currentActor.id) {
        return Timeline.MAIN
      }
      if (!isFollowing) {
        return null
      }
      const value = await mainTimelineRule({
        database,
        currentActor,
        status: repliedStatus
      })
      return value
    }
  )
