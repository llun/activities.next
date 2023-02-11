import { StatusType } from '../models/status'
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
  storage,
  currentActor,
  status
}) => {
  if (status.type === StatusType.Announce) return null
  if (status.actorId === currentActor.id) return Timeline.NOANNOUNCE
  const isFollowing = await storage.isCurrentActorFollowing({
    currentActorId: currentActor.id,
    followingActorId: status.actorId
  })

  if (!status.reply) {
    if (isFollowing) return Timeline.NOANNOUNCE
    return null
  }

  const repliedStatus = await storage.getStatus({ statusId: status.reply })
  // Deleted parent status, don't show child status
  if (!repliedStatus) return null
  if (repliedStatus.actorId === currentActor.id) return Timeline.NOANNOUNCE
  if (!isFollowing) return null
  return noannounceTimelineRule({
    storage,
    currentActor,
    status: repliedStatus.data
  })
}
