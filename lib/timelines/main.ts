import { StatusType } from '../models/status'
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
  storage,
  currentActor,
  status
}) => {
  if (status.type === StatusType.Announce) {
    const isFollowing = await storage.isCurrentActorFollowing({
      currentActorId: currentActor.id,
      followingActorId: status.actorId
    })
    if (!isFollowing) return null

    const originalStatus = status.originalStatus
    const timeline = await mainTimelineRule({
      storage,
      currentActor,
      status: originalStatus
    })
    if (timeline === Timeline.MAIN) return null
    return Timeline.MAIN
  }

  if (status.actorId === currentActor.id) return Timeline.MAIN
  const isFollowing = await storage.isCurrentActorFollowing({
    currentActorId: currentActor.id,
    followingActorId: status.actorId
  })

  if (!status.reply) {
    if (isFollowing) return Timeline.MAIN
    return null
  }

  const repliedStatus = await storage.getStatus({
    statusId: status.reply,
    withReplies: false
  })
  // Deleted parent status, don't show child status
  if (!repliedStatus) return null
  if (repliedStatus.actorId === currentActor.id) return Timeline.MAIN
  if (!isFollowing) return null
  return mainTimelineRule({ storage, currentActor, status: repliedStatus.data })
}
