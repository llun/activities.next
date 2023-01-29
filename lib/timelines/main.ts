import { MainTimelineRule, Timeline } from './types'

export const mainTimelineRule: MainTimelineRule = async ({
  currentActor,
  status
}) => {
  if (status.actorId === currentActor.id) return Timeline.MAIN
  return null
}
