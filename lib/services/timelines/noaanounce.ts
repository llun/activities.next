import { StatusType } from '@/lib/models/status'
import { getTracer } from '@/lib/utils/trace'

import { NoAnnounceTimelineRule, Timeline } from './types'

/**
 * No announce timeline
 *
 * Timeline that shows only statuses the same as main timeline without any
 * announce statuses
 *
 * Includes
 * - Self status
 * - Following people status
 * - Following people status that replied to another following people status
 * - Non-following people status that reply to self status
 *
 * Excludes
 * - Following people status that replied to non-following people status
 * - Non following people status
 * - Announce statuses
 * - Announce that has status already in the timeline
 * - Deleted status
 *
 */
export const noannounceTimelineRule: NoAnnounceTimelineRule = async ({
  database,
  currentActor,
  status
}) =>
  getTracer().startActiveSpan(
    'timelines.noAnnounceTimelineRule',
    {
      attributes: {
        actorId: currentActor.id,
        statusId: status.id
      }
    },
    async (span) => {
      if (status.type === StatusType.enum.Announce) {
        span.end()
        return null
      }
      if (status.actorId === currentActor.id) {
        span.end()
        return Timeline.NOANNOUNCE
      }
      const isFollowing = await database.isCurrentActorFollowing({
        currentActorId: currentActor.id,
        followingActorId: status.actorId
      })

      if (!status.reply) {
        span.end()
        if (isFollowing) return Timeline.NOANNOUNCE
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
        return Timeline.NOANNOUNCE
      }
      if (!isFollowing) {
        span.end()
        return null
      }
      const value = await noannounceTimelineRule({
        database,
        currentActor,
        status: repliedStatus
      })
      span.end()
      return value
    }
  )
