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
 *
 * Excludes
 * - Following people status that replied to non-following people status
 * - Non following people status
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
  if (isFollowing) return Timeline.MAIN
  return null
}
