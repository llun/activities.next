import { MainTimelineRule, Timeline, TimelineRuleParams } from './types'

/**
 * Main timeline
 *
 * Timeline that shows in the main index when user logged in to the server
 *
 * Includes
 * - Self status
 * - Following people status
 * - Following people status that replied to another following people status
 * - Announce from following people that the status is not already in the timeline
 *
 * Excludes
 * - Following people status that replied to non-following people status
 * - Non following people status
 * - Announce that has status already in the timeline
 * - Deleted status
 * - Announce that already has status in the timeline
 *
 */
export const mainTimelineRule: MainTimelineRule = async ({
  storage,
  currentActor,
  status
}) => {
  if (status.actorId === currentActor.id) return Timeline.MAIN
  const isFollowing = await storage.isCurrentActorFollowing({
    currentActorId: currentActor.id,
    followingActorId: status.actorId
  })

  if (!status.reply) {
    if (isFollowing) return Timeline.MAIN
    return null
  }

  const repliedStatus = await storage.getStatus({ statusId: status.reply })
  // Deleted parent status, don't show child status
  if (!repliedStatus) return null
  if (repliedStatus.actorId === currentActor.id) return Timeline.MAIN
  if (!isFollowing) return null
  return mainTimelineRule({ storage, currentActor, status: repliedStatus })
}
