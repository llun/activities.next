import { StatusType } from '@/lib/models/status'
import { getTracer } from '@/lib/utils/trace'

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
  getTracer().startActiveSpan(
    'timelines.mainTimelineRule',
    {
      attributes: {
        actorId: currentActor.id,
        statusId: status.id
      }
    },
    async (span) => {
      if (status.type === StatusType.enum.Announce) {
        const isFollowing = await database.isCurrentActorFollowing({
          currentActorId: currentActor.id,
          followingActorId: status.actorId
        })
        if (!isFollowing) {
          span.end()
          return null
        }

        const originalStatus = status.originalStatus
        const timeline = await mainTimelineRule({
          database,
          currentActor,
          status: originalStatus
        })
        span.end()
        if (timeline === Timeline.MAIN) return null
        return Timeline.MAIN
      }

      if (status.actorId === currentActor.id) {
        span.end()
        return Timeline.MAIN
      }
      const isFollowing = await database.isCurrentActorFollowing({
        currentActorId: currentActor.id,
        followingActorId: status.actorId
      })

      if (!status.reply) {
        span.end()
        if (isFollowing) return Timeline.MAIN
        return null
      }

      const repliedStatus = await database.getStatus({
        statusId: status.reply,
        withReplies: false
      })
      // Deleted parent status, don't show child status
      if (!repliedStatus) {
        span.end()
        return null
      }
      if (repliedStatus.actorId === currentActor.id) {
        span.end()
        return Timeline.MAIN
      }
      if (!isFollowing) {
        span.end()
        return null
      }
      const value = await mainTimelineRule({
        database,
        currentActor,
        status: repliedStatus
      })
      span.end()
      return value
    }
  )
